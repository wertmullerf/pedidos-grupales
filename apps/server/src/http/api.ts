import { randomUUID } from 'node:crypto';
import {
  CreateOrderBody,
  JoinOrderBody,
  ORDER_CODE_LENGTH,
  type JoinResponse,
  type TenantInfo,
} from '@pedido/shared';
import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { signToken } from '../auth/token.js';
import { orderNotFound } from '../orders/order-repo.js';
import type { Publisher } from '../realtime/realtime.js';
import type { RedisClient } from '../redis.js';
import { requireParticipant } from './auth.js';
import { AppError } from './errors.js';
import { rateLimit, type RateLimitRule } from './rate-limit.js';
import { resolveTenant } from './tenant.js';

export interface ApiDeps {
  pool: pg.Pool;
  redis: RedisClient;
  tokenSecret: string;
  rateLimits: { preview: RateLimitRule; join: RateLimitRule; keyPrefix?: string };
  /** Emite a la sala del pedido (tiempo real). Opcional para poder usar la API sin sockets. */
  publish?: Publisher;
}

export const DEFAULT_RATE_LIMITS: ApiDeps['rateLimits'] = {
  preview: { limit: 60, windowSeconds: 60 },
  join: { limit: 20, windowSeconds: 60 },
};

/** Los códigos se aceptan en minúsculas; uno con formato inválido directamente no existe. */
function parseCode(raw: unknown): string {
  if (typeof raw !== 'string') throw orderNotFound();
  const code = raw.toUpperCase();
  if (!new RegExp(`^[A-Z0-9]{${ORDER_CODE_LENGTH}}$`).test(code)) throw orderNotFound();
  return code;
}

export function apiRouter({ pool, redis, tokenSecret, rateLimits, publish }: ApiDeps): Router {
  const limitPreview = rateLimit(redis, 'preview', rateLimits.preview, rateLimits.keyPrefix);
  const limitJoin = rateLimit(redis, 'join', rateLimits.join, rateLimits.keyPrefix);
  const tenantRouter = Router({ mergeParams: true });

  tenantRouter.get('/', (_req, res) => {
    const { slug, name, primaryColor, logoUrl } = res.locals.tenant;
    res.json({ slug, name, primaryColor, logoUrl } satisfies TenantInfo);
  });

  tenantRouter.get('/branches', async (_req, res) => {
    res.json(await res.locals.catalog.listBranches());
  });

  tenantRouter.get('/menu', async (_req, res) => {
    res.json(await res.locals.catalog.listMenu());
  });

  // Pantalla de cocina: pedidos ya enviados a la sucursal (los nuevos llegan por socket).
  tenantRouter.get('/branches/:branchId/kitchen/orders', async (req, res) => {
    const branchId = z.uuid().safeParse(req.params.branchId);
    const branches = await res.locals.catalog.listBranches();
    if (!branchId.success || !branches.some((b) => b.id === branchId.data)) {
      throw new AppError(404, 'BRANCH_NOT_FOUND', 'Sucursal inexistente');
    }
    res.json(await res.locals.orders.listKitchenOrders(branchId.data));
  });

  tenantRouter.post('/orders', async (req, res) => {
    const body = CreateOrderBody.parse(req.body);
    const { orderId, code, participant } = await res.locals.orders.createOrder(
      body.branchId,
      body.name,
    );
    const token = signToken(
      { tenantId: res.locals.tenant.id, orderId, participantId: participant.id },
      tokenSecret,
    );
    res.status(201).json({ code, participant, token } satisfies JoinResponse);
  });

  tenantRouter.post('/orders/:code/join', limitJoin, async (req, res) => {
    const code = parseCode(req.params.code);
    const body = JoinOrderBody.parse(req.body);
    const { orderId, participant, event } = await res.locals.orders.joinOrder(
      code,
      body.name,
      body.clientOpId ?? randomUUID(),
    );
    // Después del COMMIT: los que ya están en el pedido ven llegar al nuevo participante.
    if (event) publish?.(res.locals.tenant.id, event);
    const token = signToken(
      { tenantId: res.locals.tenant.id, orderId, participantId: participant.id },
      tokenSecret,
    );
    res.status(201).json({ code, participant, token } satisfies JoinResponse);
  });

  // Público: solo lo necesario para decidir unirse.
  tenantRouter.get('/orders/:code', limitPreview, async (req, res) => {
    res.json(await res.locals.orders.getPreview(parseCode(req.params.code)));
  });

  // Completo: requiere el token de un participante de este pedido.
  tenantRouter.get('/orders/:code/snapshot', requireParticipant(tokenSecret), async (req, res) => {
    res.json(
      await res.locals.orders.getSnapshot(parseCode(req.params.code), res.locals.actor.orderId),
    );
  });

  const router = Router();
  router.use('/t/:tenantSlug', resolveTenant(pool), tenantRouter);
  return router;
}
