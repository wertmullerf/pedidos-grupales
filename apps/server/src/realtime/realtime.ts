import type { Server as HttpServer } from 'node:http';
import {
  ChoosingSchema,
  COMMAND_NAMES,
  ResyncRequestSchema,
  type ApiError,
  type ClientToServerEvents,
  type CommandAck,
  type CommandName,
  type ErrorAck,
  type OrderEvent,
  type ServerToClientEvents,
} from '@pedido/shared';
import { createAdapter } from '@socket.io/redis-adapter';
import type pg from 'pg';
import { Server, type Socket } from 'socket.io';
import { z, ZodError } from 'zod';
import { authenticateParticipant } from '../http/auth.js';
import { AppError } from '../http/errors.js';
import { OrderRepo } from '../orders/order-repo.js';
import { OrderService, type MutationResult } from '../orders/order-service.js';
import type { RedisClient } from '../redis.js';
import { CatalogRepo, findTenantBySlug } from '../tenant/catalog-repo.js';
import { TokenBucket, type TokenBucketRule } from './token-bucket.js';

/** Sala namespaceada por cadena (regla 12). Se deriva del token: el cliente no elige a qué sala entra. */
export const roomFor = (tenantId: string, orderId: string) => `tenant:${tenantId}:order:${orderId}`;
export const kitchenRoomFor = (tenantId: string, branchId: string) =>
  `tenant:${tenantId}:branch:${branchId}:kitchen`;

export type Publisher = (tenantId: string, event: OrderEvent) => void;

export interface RealtimeDeps {
  pool: pg.Pool;
  /** Cliente conectado; se duplica para el pub/sub del adapter. */
  redis: RedisClient;
  tokenSecret: string;
  socketRateLimit?: TokenBucketRule;
  /** Hueco máximo que se resuelve reenviando eventos; más allá, se manda un snapshot. */
  maxResyncEvents?: number;
}

export const DEFAULT_SOCKET_RATE_LIMIT: TokenBucketRule = { capacity: 30, refillPerSecond: 15 };
export const DEFAULT_MAX_RESYNC_EVENTS = 200;

/** Solo datos planos: el adapter los serializa cuando otra instancia hace fetchSockets(). */
type SocketData =
  | {
      kind: 'participant';
      tenantId: string;
      orderId: string;
      participantId: string;
      choosing: boolean;
    }
  | { kind: 'kitchen'; tenantId: string; branchId: string };

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

const KitchenAuth = z.object({
  kind: z.literal('kitchen'),
  tenantSlug: z.string(),
  branchId: z.uuid(),
});
const ParticipantAuth = z.object({ tenantSlug: z.string(), token: z.string().optional() });

export async function attachRealtime(httpServer: HttpServer, deps: RealtimeDeps) {
  const {
    pool,
    tokenSecret,
    socketRateLimit = DEFAULT_SOCKET_RATE_LIMIT,
    maxResyncEvents = DEFAULT_MAX_RESYNC_EVENTS,
  } = deps;

  const pubClient = deps.redis.duplicate();
  const subClient = deps.redis.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);

  const io: AppServer = new Server(httpServer, {
    // Solo WebSocket: con nginx round-robin, el long-polling necesitaría sticky sessions.
    transports: ['websocket'],
    serveClient: false,
    adapter: createAdapter(pubClient, subClient),
  });

  /**
   * Se llama solo después del COMMIT. Si el emit falla no se reintenta: el cliente detecta el
   * salto de versión en el próximo evento (o al reconectar) y pide resync (reglas 7 y 8).
   */
  const publish: Publisher = (tenantId, event) => {
    try {
      io.to(roomFor(tenantId, event.orderId)).emit('order:event', event);
    } catch (err) {
      console.error('[realtime] no se pudo emitir el evento', event.version, err);
    }
  };

  /** Un pedido recién enviado aparece en vivo en la pantalla de cocina de su sucursal. */
  async function publishToKitchen(tenantId: string, orderId: string) {
    try {
      const repo = new OrderRepo(pool, tenantId);
      const branchId = await repo.getBranchId(orderId);
      if (!branchId) return;
      const [order] = await repo.listKitchenOrders(branchId, { orderId });
      if (order) io.to(kitchenRoomFor(tenantId, branchId)).emit('kitchen:order', order);
    } catch (err) {
      console.error('[realtime] no se pudo avisar a la cocina', err);
    }
  }

  // Autenticación en el handshake: el token tiene que ser de la cadena indicada (regla 10).
  io.use(async (socket, next) => {
    try {
      const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
      const { tenantSlug } = ParticipantAuth.parse(auth);
      const tenant = await findTenantBySlug(pool, tenantSlug);
      if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'Cadena inexistente');

      if (auth.kind === 'kitchen') {
        // Demo: la pantalla de cocina no tiene login (fuera de alcance); solo ve pedidos enviados.
        const { branchId } = KitchenAuth.parse(auth);
        const branches = await new CatalogRepo(pool, tenant.id).listBranches();
        if (!branches.some((b) => b.id === branchId)) {
          throw new AppError(404, 'BRANCH_NOT_FOUND', 'Sucursal inexistente');
        }
        socket.data = { kind: 'kitchen', tenantId: tenant.id, branchId };
      } else {
        const token = typeof auth.token === 'string' ? auth.token : undefined;
        const actor = authenticateParticipant(token, tenant.id, tokenSecret);
        socket.data = { kind: 'participant', ...actor, choosing: false };
      }
      next();
    } catch (err) {
      let code: ApiError['code'] = 'INTERNAL';
      if (err instanceof AppError) code = err.code;
      else if (err instanceof ZodError) code = 'UNAUTHORIZED';
      else console.error('[realtime] handshake', err);
      next(Object.assign(new Error(code), { data: { code } }));
    }
  });

  io.on('connection', (socket) => {
    const data = socket.data;
    const setup =
      data.kind === 'kitchen'
        ? socket.join(kitchenRoomFor(data.tenantId, data.branchId))
        : onParticipant(socket, data);
    void Promise.resolve(setup).catch((err) => console.error('[realtime] conexión', err));
  });

  async function onParticipant(
    socket: AppSocket,
    data: Extract<SocketData, { kind: 'participant' }>,
  ) {
    const { tenantId, orderId, participantId } = data;
    const actor = { tenantId, orderId, participantId };
    const room = roomFor(tenantId, orderId);
    const service = new OrderService(pool, tenantId);
    const repo = new OrderRepo(pool, tenantId);

    // Rate limit por conexión: si se agota, el evento se descarta y se responde RATE_LIMITED.
    // No se consulta la versión para no cargar la DB justo cuando alguien está inundando.
    const bucket = new TokenBucket(socketRateLimit);
    socket.use((packet, next) => {
      if (bucket.take()) return next();
      const ack = packet[packet.length - 1];
      if (typeof ack === 'function') {
        ack({
          ok: false,
          error: { code: 'RATE_LIMITED', message: 'Demasiados eventos, bajá el ritmo' },
          version: null,
        } satisfies ErrorAck);
      }
    });

    const errorAck = async (err: unknown): Promise<ErrorAck> => {
      let error: ApiError = { code: 'INTERNAL', message: 'Error interno' };
      if (err instanceof AppError) error = { code: err.code, message: err.message };
      else if (err instanceof ZodError)
        error = { code: 'VALIDATION_ERROR', message: 'Datos inválidos' };
      else console.error('[realtime]', err);
      const version = await repo.getVersion(orderId).catch(() => null);
      return { ok: false, error, version };
    };

    // Toda mutación pasa por el servicio de la fase 3 y se emite a la sala tras el COMMIT.
    const commands: Record<CommandName, (payload: never) => Promise<MutationResult>> = {
      'item:add': (p) => service.addItem(actor, p),
      'item:increment': (p) => service.incrementItem(actor, p),
      'item:remove': (p) => service.removeItem(actor, p),
      'item:notes': (p) => service.updateNotes(actor, p),
      'order:lock': (p) => service.lockOrder(actor, p),
      'order:unlock': (p) => service.unlockOrder(actor, p),
      'order:submit': (p) => service.submitOrder(actor, p),
    };
    for (const name of COMMAND_NAMES) {
      const run = commands[name];
      socket.on(name, async (payload, ack) => {
        if (typeof ack !== 'function') return; // sin ack el cliente no podría confirmar ni revertir
        try {
          const result = await run(payload as never);
          // Un duplicado ya se emitió cuando se aplicó; si ese emit se perdió, lo cubre el resync.
          if (result.status === 'applied') {
            publish(tenantId, result.event);
            if (result.event.type === 'order_submitted') void publishToKitchen(tenantId, orderId);
          }
          ack({
            ok: true,
            status: result.status,
            version: result.event.version,
            event: result.event,
          } satisfies CommandAck);
        } catch (err) {
          ack(await errorAck(err));
        }
      });
    }

    // Resync por versión (regla 7): eventos si el hueco es chico, snapshot si es grande o no hay base.
    socket.on('order:resync', async (payload, ack) => {
      if (typeof ack !== 'function') return;
      try {
        const { sinceVersion } = ResyncRequestSchema.parse(payload);
        if (sinceVersion !== null) {
          const events = await repo.getEventsSince(orderId, sinceVersion, maxResyncEvents);
          if (events) return ack({ ok: true, mode: 'events', events });
        }
        ack({ ok: true, mode: 'snapshot', snapshot: await repo.getSnapshotById(orderId) });
      } catch (err) {
        ack(await errorAck(err));
      }
    });

    // Presencia: efímera, solo en memoria de los sockets y compartida vía el adapter de Redis.
    // Nunca toca Postgres ni la versión del pedido.
    socket.on('presence:choosing', (payload) => {
      const parsed = ChoosingSchema.safeParse(payload);
      if (!parsed.success || data.choosing === parsed.data.choosing) return;
      data.choosing = parsed.data.choosing;
      void broadcastPresence(room);
    });

    socket.on('disconnect', () => void broadcastPresence(room));

    await socket.join(room);
    await broadcastPresence(room);
  }

  // Al apagar, io.close() desconecta los sockets y eso dispararía broadcastPresence contra un
  // Redis ya cerrado. El adapter no atrapa ese publish fallido (quedaría como rechazo no manejado).
  let closing = false;

  /** Recalcula la presencia de la sala mirando los sockets de TODAS las instancias. */
  async function broadcastPresence(room: string) {
    if (closing) return;
    try {
      const sockets = await io.in(room).fetchSockets();
      const choosingByParticipant = new Map<string, boolean>();
      for (const { data } of sockets) {
        if (data.kind !== 'participant') continue;
        const prev = choosingByParticipant.get(data.participantId) ?? false;
        choosingByParticipant.set(data.participantId, prev || data.choosing);
      }
      io.to(room).emit('presence:state', {
        participants: [...choosingByParticipant].map(([participantId, choosing]) => ({
          participantId,
          choosing,
        })),
      });
    } catch (err) {
      console.error('[realtime] presencia', err);
    }
  }

  return {
    io,
    publish,
    async close() {
      closing = true;
      await io.close();
      await Promise.allSettled([pubClient.quit(), subClient.quit()]);
    },
  };
}

export type Realtime = Awaited<ReturnType<typeof attachRealtime>>;
