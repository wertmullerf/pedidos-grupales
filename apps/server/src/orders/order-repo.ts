import { randomInt, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { isUniqueViolation, Rollback, withTransaction } from '../db/tx.js';
import { AppError } from '../http/errors.js';

// Sin 0/O ni 1/I para que el código se pueda dictar sin confusiones.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export const PARTICIPANT_COLORS = [
  '#E03131',
  '#1971C2',
  '#2F9E44',
  '#F08C00',
  '#9C36B5',
  '#0C8599',
  '#C2255C',
  '#5C940D',
];

export interface Participant {
  id: string;
  name: string;
  color: string;
}

export interface JoinResult {
  orderId: string;
  participant: Participant;
}

export interface OrderSnapshot {
  order: {
    id: string;
    code: string;
    status: OrderStatus;
    version: number;
    hostParticipantId: string;
    createdAt: string;
    updatedAt: string;
  };
  branch: { id: string; name: string; address: string; isOpen: boolean };
  participants: (Participant & { joinedAt: string })[];
  items: {
    id: string;
    participantId: string;
    menuItemId: string;
    name: string;
    unitPriceCents: number;
    quantity: number;
    notes: string;
  }[];
  totalCents: number;
}

/** Vista pública de un pedido: alcanza para la pantalla de "unirse", sin exponer ítems ni nombres. */
export interface OrderPreview {
  tenant: { slug: string; name: string };
  branch: { name: string; address: string };
  hostName: string;
  participantCount: number;
  status: OrderStatus;
}

export type OrderStatus = 'open' | 'locked' | 'submitted';

export function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export const MAX_CODE_ATTEMPTS = 5;

/**
 * Acceso a pedidos de UNA cadena: todas las queries filtran por el tenantId del constructor,
 * así el aislamiento no depende de acordarse en cada endpoint (regla 10).
 */
export class OrderRepo {
  constructor(
    private readonly pool: pg.Pool,
    private readonly tenantId: string,
    // Inyectable para poder testear el reintento ante colisión de códigos.
    private readonly nextCode: () => string = generateCode,
  ) {}

  /**
   * Crea el pedido y su participante host. Rechaza sucursales de otra cadena o cerradas (regla 13).
   * Si el código choca con el UNIQUE (tenant_id, code), reintenta con uno nuevo.
   */
  async createOrder(branchId: string, hostName: string): Promise<JoinResult & { code: string }> {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const orderId = randomUUID();
      const host: Participant = { id: randomUUID(), name: hostName, color: PARTICIPANT_COLORS[0]! };
      const code = this.nextCode();
      try {
        return await withTransaction(this.pool, async (client) => {
          // La validación de sucursal va en el mismo INSERT: 0 filas = no existe, es de otra cadena o está cerrada.
          const inserted = await client.query(
            `INSERT INTO group_orders (id, tenant_id, branch_id, code, host_participant_id)
             SELECT $1, tenant_id, id, $4, $5 FROM branches
             WHERE id = $3 AND tenant_id = $2 AND is_open`,
            [orderId, this.tenantId, branchId, code, host.id],
          );
          if (inserted.rowCount === 0) throw await this.branchError(client, branchId);

          await client.query(
            `INSERT INTO participants (id, order_id, name, color) VALUES ($1, $2, $3, $4)`,
            [host.id, orderId, host.name, host.color],
          );
          return { orderId, code, participant: host };
        });
      } catch (err) {
        if (isUniqueViolation(err, 'group_orders_tenant_id_code_key')) continue;
        throw err;
      }
    }
    throw new Error('No se pudo generar un código de pedido único');
  }

  /**
   * Suma un participante con la transacción corta de la regla 4:
   * 1) sube la versión (lockea la fila y exige status 'open'), 2) registra el evento con
   * idempotencia por clientOpId, 3) inserta el participante con el color decidido en el paso 2.
   */
  async joinOrder(code: string, name: string, clientOpId: string): Promise<JoinResult> {
    const participantId = randomUUID();
    const outcome = await withTransaction(this.pool, async (client) => {
      const bumped = await client.query<{ id: string; version: number }>(
        `UPDATE group_orders SET version = version + 1, updated_at = now()
         WHERE tenant_id = $1 AND code = $2 AND status = 'open'
         RETURNING id, version`,
        [this.tenantId, code],
      );
      const order = bumped.rows[0];
      if (!order) return new Rollback('rejected' as const);

      // El color sale de cuántos participantes hay; es consistente porque la fila del pedido ya está lockeada.
      const event = await client.query<{ participant: Participant }>(
        `INSERT INTO order_events (order_id, version, client_op_id, type, payload)
         VALUES ($1, $2, $3, 'participant_joined', jsonb_build_object('participant', jsonb_build_object(
           'id', $4::uuid, 'name', $5::text,
           'color', ($6::text[])[(SELECT count(*) FROM participants WHERE order_id = $1) % $7 + 1])))
         ON CONFLICT (client_op_id) DO NOTHING
         RETURNING payload->'participant' AS participant`,
        [
          order.id,
          order.version,
          clientOpId,
          participantId,
          name,
          PARTICIPANT_COLORS,
          PARTICIPANT_COLORS.length,
        ],
      );
      const participant = event.rows[0]?.participant;
      // Ya aplicada: se deshace el bump de versión y se responde con el resultado original.
      if (!participant) return new Rollback('duplicate' as const);

      await client.query(
        `INSERT INTO participants (id, order_id, name, color) VALUES ($1, $2, $3, $4)`,
        [participant.id, order.id, participant.name, participant.color],
      );
      return { orderId: order.id, participant };
    });

    if (outcome === 'duplicate') return this.replayJoin(code, clientOpId);
    if (outcome === 'rejected') throw await this.orderRejection(code);
    return outcome;
  }

  async getPreview(code: string): Promise<OrderPreview> {
    const { rows } = await this.pool.query<OrderPreview>(
      `SELECT json_build_object('slug', t.slug, 'name', t.name) AS tenant,
              json_build_object('name', b.name, 'address', b.address) AS branch,
              h.name AS "hostName",
              (SELECT count(*)::int FROM participants p WHERE p.order_id = o.id) AS "participantCount",
              o.status
       FROM group_orders o
       JOIN tenants t ON t.id = o.tenant_id
       JOIN branches b ON b.id = o.branch_id AND b.tenant_id = o.tenant_id
       JOIN participants h ON h.id = o.host_participant_id AND h.order_id = o.id
       WHERE o.tenant_id = $1 AND o.code = $2`,
      [this.tenantId, code],
    );
    const row = rows[0];
    if (!row) throw orderNotFound();
    return row;
  }

  /**
   * Snapshot completo, solo para participantes: se filtra también por el pedido del token.
   * Es consistente porque sale de una sola query (un único statement ve un único estado).
   */
  async getSnapshot(code: string, tokenOrderId: string): Promise<OrderSnapshot> {
    const { rows } = await this.pool.query<{ snapshot: OrderSnapshot }>(
      `SELECT json_build_object(
         'order', json_build_object(
           'id', o.id, 'code', o.code, 'status', o.status, 'version', o.version,
           'hostParticipantId', o.host_participant_id,
           'createdAt', o.created_at, 'updatedAt', o.updated_at),
         'branch', json_build_object('id', b.id, 'name', b.name, 'address', b.address, 'isOpen', b.is_open),
         'participants', COALESCE((
           SELECT json_agg(json_build_object('id', p.id, 'name', p.name, 'color', p.color, 'joinedAt', p.joined_at)
                           ORDER BY p.joined_at, p.id)
           FROM participants p WHERE p.order_id = o.id), '[]'),
         'items', COALESCE((
           SELECT json_agg(json_build_object(
                    'id', i.id, 'participantId', i.participant_id, 'menuItemId', i.menu_item_id,
                    'name', m.name, 'unitPriceCents', i.unit_price_cents,
                    'quantity', i.quantity, 'notes', i.notes)
                  ORDER BY i.created_at, i.id)
           FROM order_items i
           JOIN menu_items m ON m.id = i.menu_item_id AND m.tenant_id = i.tenant_id
           WHERE i.order_id = o.id AND i.tenant_id = o.tenant_id), '[]'),
         'totalCents', (
           SELECT COALESCE(sum(i.quantity * i.unit_price_cents), 0)::int
           FROM order_items i WHERE i.order_id = o.id AND i.tenant_id = o.tenant_id)
       ) AS snapshot
       FROM group_orders o
       JOIN branches b ON b.id = o.branch_id AND b.tenant_id = o.tenant_id
       WHERE o.tenant_id = $1 AND o.code = $2 AND o.id = $3`,
      [this.tenantId, code, tokenOrderId],
    );
    const row = rows[0];
    if (!row) throw await this.snapshotRejection(code);
    return row.snapshot;
  }

  // --- Caminos de error: solo se consultan después de un rechazo, no en el camino feliz. ---

  private async replayJoin(code: string, clientOpId: string): Promise<JoinResult> {
    const { rows } = await this.pool.query<JoinResult>(
      `SELECT e.order_id AS "orderId", e.payload->'participant' AS participant
       FROM order_events e JOIN group_orders o ON o.id = e.order_id
       WHERE e.client_op_id = $1 AND e.type = 'participant_joined'
         AND o.tenant_id = $2 AND o.code = $3`,
      [clientOpId, this.tenantId, code],
    );
    const row = rows[0];
    if (!row)
      throw new AppError(409, 'CLIENT_OP_CONFLICT', 'clientOpId ya usado en otra operación');
    return row;
  }

  /** El código existe pero el token es de otro pedido => 403; si no existe => 404. */
  private async snapshotRejection(code: string): Promise<AppError> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM group_orders WHERE tenant_id = $1 AND code = $2`,
      [this.tenantId, code],
    );
    return rowCount
      ? new AppError(403, 'FORBIDDEN', 'El token no pertenece a este pedido')
      : orderNotFound();
  }

  private async orderRejection(code: string): Promise<AppError> {
    const { rows } = await this.pool.query<{ status: string }>(
      `SELECT status FROM group_orders WHERE tenant_id = $1 AND code = $2`,
      [this.tenantId, code],
    );
    return rows[0]
      ? new AppError(409, 'ORDER_LOCKED', 'El pedido ya está cerrado')
      : orderNotFound();
  }

  private async branchError(client: pg.PoolClient, branchId: string): Promise<AppError> {
    const { rows } = await client.query<{ is_open: boolean }>(
      `SELECT is_open FROM branches WHERE id = $1 AND tenant_id = $2`,
      [branchId, this.tenantId],
    );
    return rows[0]
      ? new AppError(409, 'BRANCH_CLOSED', 'La sucursal está cerrada')
      : new AppError(404, 'BRANCH_NOT_FOUND', 'Sucursal inexistente');
  }
}

export function orderNotFound(): AppError {
  return new AppError(404, 'ORDER_NOT_FOUND', 'Pedido inexistente');
}
