import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { ParticipantToken } from '../auth/token.js';
import {
  AddItemCommand,
  IncrementItemCommand,
  OrderStatusCommand,
  RemoveItemCommand,
  UpdateNotesCommand,
  type AddItemInput,
  type EventType,
  type IncrementItemInput,
  type OrderEvent,
  type OrderItem,
  type OrderStatus,
  type OrderStatusInput,
  type RemoveItemInput,
  type UpdateNotesInput,
} from '@pedido/shared';
import { isUniqueViolation, Rollback, withTransaction } from '../db/tx.js';
import { AppError } from '../http/errors.js';
import { orderNotFound } from './order-repo.js';

/** `applied`: se aplicó ahora. `duplicate`: el clientOpId ya se había aplicado; se devuelve el evento original. */
export interface MutationResult {
  status: 'applied' | 'duplicate';
  event: OrderEvent;
}

type Payload = Record<string, unknown>;

type Rejection = { kind: 'rejected' | 'duplicate' | 'invalid' };
type Applied = { kind: 'applied'; payload: Payload; version: number };

interface MutationSpec {
  type: EventType;
  /** Estado requerido para aplicar la operación. */
  from: OrderStatus;
  /** Nuevo estado del pedido, si la operación lo cambia. */
  to?: OrderStatus;
  hostOnly?: boolean;
  /** Condiciones extra sobre `o` (el pedido) en el UPDATE del paso 1. Puede usar $1 (order) y $2 (tenant). */
  extraWhere?: string;
  /**
   * Expresión jsonb del payload del evento. Parámetros fijos: $1 order_id, $5 participant_id;
   * los de `params` arrancan en $6. Se evalúa con la fila del pedido ya lockeada, así que lo
   * que lea de order_items es estable hasta el COMMIT.
   */
  payloadSql?: string;
  params?: unknown[];
  /** Si el payload indica que la operación no aplica (p. ej. ítem ajeno), se hace ROLLBACK. */
  isValid?: (payload: Payload) => boolean;
  explainInvalid?: () => Promise<AppError>;
  /** Paso 3: la mutación sobre order_items. */
  apply?: (client: pg.PoolClient, payload: Payload) => Promise<void>;
}

/**
 * Mutaciones de un pedido (reglas 2 a 6). Cada operación es UNA transacción corta:
 *   1. UPDATE group_orders ... version + 1 ... RETURNING  → lock de fila + estado + versión
 *   2. INSERT order_events ... ON CONFLICT (client_op_id) DO NOTHING → evento + idempotencia
 *   3. la mutación sobre order_items, filtrando por participant_id y usando deltas
 * El lock de la fila del pedido serializa solo las operaciones de ese pedido; los demás pedidos
 * no esperan. Las consultas de diagnóstico solo corren tras un rechazo, fuera del camino feliz.
 */
export class OrderService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly tenantId: string,
  ) {}

  async addItem(actor: ParticipantToken, input: AddItemInput): Promise<MutationResult> {
    const cmd = AddItemCommand.parse(input);
    // Nombre y precio salen del menú de ESTA cadena y solo si está disponible (regla 11);
    // el precio queda congelado en la línea.
    return this.mutate(actor, cmd.clientOpId, {
      type: 'item_added',
      from: 'open',
      payloadSql: `jsonb_build_object('item', (
        SELECT jsonb_build_object(
          'id', $6::uuid, 'participantId', $5::uuid, 'menuItemId', m.id, 'name', m.name,
          'unitPriceCents', m.price_cents, 'quantity', $8::int, 'notes', $9::text)
        FROM menu_items m WHERE m.id = $7 AND m.tenant_id = $10 AND m.available))`,
      params: [cmd.itemId ?? randomUUID(), cmd.menuItemId, cmd.quantity, cmd.notes, this.tenantId],
      isValid: (p) => p.item != null,
      explainInvalid: () => this.menuItemRejection(cmd.menuItemId),
      apply: async (client, p) => {
        const item = p.item as OrderItem;
        await client
          .query(
            `INSERT INTO order_items
             (id, tenant_id, order_id, participant_id, menu_item_id, unit_price_cents, quantity, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              item.id,
              this.tenantId,
              actor.orderId,
              actor.participantId,
              item.menuItemId,
              item.unitPriceCents,
              item.quantity,
              item.notes,
            ],
          )
          .catch((err) => {
            // El id de línea lo puede proponer el cliente: si ya existe, no es un error interno.
            if (isUniqueViolation(err, 'order_items_pkey')) {
              throw new AppError(409, 'ITEM_ID_CONFLICT', 'Ese id de línea ya existe');
            }
            throw err;
          });
      },
    });
  }

  /** Suma un delta a una línea propia. Si la cantidad resultante llega a 0 o menos, la línea se elimina. */
  async incrementItem(actor: ParticipantToken, input: IncrementItemInput): Promise<MutationResult> {
    const cmd = IncrementItemCommand.parse(input);
    return this.mutate(actor, cmd.clientOpId, {
      type: 'item_incremented',
      from: 'open',
      payloadSql: `jsonb_build_object('itemId', $6::uuid, 'delta', $7::int, 'quantity', (
        SELECT GREATEST(i.quantity + $7, 0) FROM order_items i
        WHERE i.id = $6 AND i.order_id = $1 AND i.participant_id = $5))`,
      params: [cmd.itemId, cmd.delta],
      isValid: (p) => p.quantity != null,
      explainInvalid: () => this.itemRejection(actor, cmd.itemId),
      apply: async (client, p) => {
        const args = [cmd.itemId, actor.orderId, actor.participantId];
        if ((p.quantity as number) > 0) {
          await client.query(
            `UPDATE order_items SET quantity = quantity + $4
             WHERE id = $1 AND order_id = $2 AND participant_id = $3`,
            [...args, cmd.delta],
          );
        } else {
          await client.query(
            `DELETE FROM order_items WHERE id = $1 AND order_id = $2 AND participant_id = $3`,
            args,
          );
        }
      },
    });
  }

  async removeItem(actor: ParticipantToken, input: RemoveItemInput): Promise<MutationResult> {
    const cmd = RemoveItemCommand.parse(input);
    return this.mutate(actor, cmd.clientOpId, {
      type: 'item_removed',
      from: 'open',
      payloadSql: `jsonb_build_object('itemId', (
        SELECT i.id FROM order_items i WHERE i.id = $6 AND i.order_id = $1 AND i.participant_id = $5))`,
      params: [cmd.itemId],
      isValid: (p) => p.itemId != null,
      explainInvalid: () => this.itemRejection(actor, cmd.itemId),
      apply: async (client) => {
        await client.query(
          `DELETE FROM order_items WHERE id = $1 AND order_id = $2 AND participant_id = $3`,
          [cmd.itemId, actor.orderId, actor.participantId],
        );
      },
    });
  }

  async updateNotes(actor: ParticipantToken, input: UpdateNotesInput): Promise<MutationResult> {
    const cmd = UpdateNotesCommand.parse(input);
    return this.mutate(actor, cmd.clientOpId, {
      type: 'item_notes_updated',
      from: 'open',
      payloadSql: `jsonb_build_object('notes', $7::text, 'itemId', (
        SELECT i.id FROM order_items i WHERE i.id = $6 AND i.order_id = $1 AND i.participant_id = $5))`,
      params: [cmd.itemId, cmd.notes],
      isValid: (p) => p.itemId != null,
      explainInvalid: () => this.itemRejection(actor, cmd.itemId),
      apply: async (client) => {
        await client.query(
          `UPDATE order_items SET notes = $4
           WHERE id = $1 AND order_id = $2 AND participant_id = $3`,
          [cmd.itemId, actor.orderId, actor.participantId, cmd.notes],
        );
      },
    });
  }

  /**
   * Cierra el pedido (regla 6). Como toda mutación exige status = 'open' en el mismo UPDATE que
   * toma el lock, cualquier operación que se serialice después de este COMMIT es rechazada.
   */
  async lockOrder(actor: ParticipantToken, input: OrderStatusInput): Promise<MutationResult> {
    const { clientOpId } = OrderStatusCommand.parse(input);
    return this.mutate(actor, clientOpId, {
      type: 'order_locked',
      from: 'open',
      to: 'locked',
      hostOnly: true,
    });
  }

  async unlockOrder(actor: ParticipantToken, input: OrderStatusInput): Promise<MutationResult> {
    const { clientOpId } = OrderStatusCommand.parse(input);
    return this.mutate(actor, clientOpId, {
      type: 'order_unlocked',
      from: 'locked',
      to: 'open',
      hostOnly: true,
    });
  }

  /** Envía el pedido a la sucursal: tiene que estar cerrado, con ítems y la sucursal abierta (regla 13). */
  async submitOrder(actor: ParticipantToken, input: OrderStatusInput): Promise<MutationResult> {
    const { clientOpId } = OrderStatusCommand.parse(input);
    return this.mutate(actor, clientOpId, {
      type: 'order_submitted',
      from: 'locked',
      to: 'submitted',
      hostOnly: true,
      extraWhere: `AND EXISTS (SELECT 1 FROM branches b
                               WHERE b.id = o.branch_id AND b.tenant_id = o.tenant_id AND b.is_open)
                   AND EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id)`,
    });
  }

  // --- Runner de la transacción de 3 statements ---

  private async mutate(
    actor: ParticipantToken,
    clientOpId: string,
    spec: MutationSpec,
  ): Promise<MutationResult> {
    if (actor.tenantId !== this.tenantId) {
      throw new AppError(403, 'FORBIDDEN', 'El token no pertenece a esta cadena');
    }

    const outcome = await withTransaction<Applied, Rejection>(this.pool, async (client) => {
      // 1. Lock + estado + versión en un solo statement.
      const bumpParams: unknown[] = [actor.orderId, this.tenantId, spec.to ?? spec.from, spec.from];
      if (spec.hostOnly) bumpParams.push(actor.participantId);
      const bumped = await client.query<{ version: number }>(
        `UPDATE group_orders o SET version = o.version + 1, updated_at = now(), status = $3
         WHERE o.id = $1 AND o.tenant_id = $2 AND o.status = $4
           ${spec.hostOnly ? 'AND o.host_participant_id = $5' : ''}
           ${spec.extraWhere ?? ''}
         RETURNING o.version`,
        bumpParams,
      );
      const version = bumped.rows[0]?.version;
      if (version === undefined) return new Rollback<Rejection>({ kind: 'rejected' });

      // 2. Evento + idempotencia.
      const inserted = await client.query<{ payload: Payload }>(
        `INSERT INTO order_events (order_id, version, client_op_id, type, payload)
         VALUES ($1, $2, $3, $4, jsonb_build_object('by', $5::uuid) || ${spec.payloadSql ?? `'{}'::jsonb`})
         ON CONFLICT (client_op_id) DO NOTHING
         RETURNING payload`,
        [
          actor.orderId,
          version,
          clientOpId,
          spec.type,
          actor.participantId,
          ...(spec.params ?? []),
        ],
      );
      const payload = inserted.rows[0]?.payload;
      if (!payload) return new Rollback<Rejection>({ kind: 'duplicate' });
      if (spec.isValid && !spec.isValid(payload))
        return new Rollback<Rejection>({ kind: 'invalid' });

      // 3. Mutación.
      await spec.apply?.(client, payload);
      return { kind: 'applied' as const, payload, version };
    });

    switch (outcome.kind) {
      case 'applied':
        return {
          status: 'applied',
          // El payload lo arma el SQL de cada operación con la forma del schema compartido.
          event: {
            orderId: actor.orderId,
            version: outcome.version,
            clientOpId,
            type: spec.type,
            payload: outcome.payload,
          } as OrderEvent,
        };
      case 'duplicate':
        return { status: 'duplicate', event: await this.replay(actor, clientOpId, spec.type) };
      case 'invalid':
        throw await spec.explainInvalid!();
      case 'rejected':
        throw await this.orderRejection(actor, spec);
    }
  }

  // --- Diagnóstico de rechazos (solo tras un ROLLBACK) ---

  private async replay(
    actor: ParticipantToken,
    clientOpId: string,
    type: EventType,
  ): Promise<OrderEvent> {
    const { rows } = await this.pool.query<OrderEvent>(
      `SELECT order_id AS "orderId", version, client_op_id AS "clientOpId", type, payload
       FROM order_events WHERE client_op_id = $1`,
      [clientOpId],
    );
    const event = rows[0];
    if (!event || event.orderId !== actor.orderId || event.type !== type) {
      throw new AppError(409, 'CLIENT_OP_CONFLICT', 'clientOpId ya usado en otra operación');
    }
    return event;
  }

  private async orderRejection(actor: ParticipantToken, spec: MutationSpec): Promise<AppError> {
    const { rows } = await this.pool.query<{
      status: OrderStatus;
      host_participant_id: string;
      branch_open: boolean;
      has_items: boolean;
    }>(
      `SELECT o.status, o.host_participant_id, b.is_open AS branch_open,
              EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id) AS has_items
       FROM group_orders o JOIN branches b ON b.id = o.branch_id AND b.tenant_id = o.tenant_id
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [actor.orderId, this.tenantId],
    );
    const order = rows[0];
    if (!order) return orderNotFound();
    if (spec.hostOnly && order.host_participant_id !== actor.participantId) {
      return new AppError(403, 'NOT_HOST', 'Solo el host puede hacer esto');
    }
    if (order.status !== spec.from) {
      return spec.from === 'open'
        ? new AppError(409, 'ORDER_LOCKED', 'El pedido ya está cerrado')
        : new AppError(409, 'INVALID_STATUS', `El pedido está en estado ${order.status}`);
    }
    if (!order.branch_open) return new AppError(409, 'BRANCH_CLOSED', 'La sucursal está cerrada');
    if (!order.has_items) return new AppError(409, 'EMPTY_ORDER', 'El pedido no tiene ítems');
    return new AppError(409, 'CONFLICT', 'No se pudo aplicar la operación');
  }

  private async itemRejection(actor: ParticipantToken, itemId: string): Promise<AppError> {
    const { rows } = await this.pool.query<{ participant_id: string }>(
      `SELECT participant_id FROM order_items WHERE id = $1 AND order_id = $2 AND tenant_id = $3`,
      [itemId, actor.orderId, this.tenantId],
    );
    const item = rows[0];
    if (!item) return new AppError(404, 'ITEM_NOT_FOUND', 'Ítem inexistente');
    return new AppError(403, 'NOT_OWNER', 'Solo podés modificar tus propios ítems');
  }

  private async menuItemRejection(menuItemId: string): Promise<AppError> {
    const { rows } = await this.pool.query<{ available: boolean }>(
      `SELECT available FROM menu_items WHERE id = $1 AND tenant_id = $2`,
      [menuItemId, this.tenantId],
    );
    return rows[0]
      ? new AppError(409, 'MENU_ITEM_UNAVAILABLE', 'El producto no está disponible')
      : new AppError(404, 'MENU_ITEM_NOT_FOUND', 'El producto no pertenece al menú');
  }
}
