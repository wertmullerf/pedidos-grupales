import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { signToken } from '../auth/token.js';
import { CODE_LENGTH, orderNotFound } from '../orders/order-repo.js';
import type { RedisClient } from '../redis.js';
import { requireParticipant } from './auth.js';
import { rateLimit, type RateLimitRule } from './rate-limit.js';
import { resolveTenant } from './tenant.js';

export interface ApiDeps {
  pool: pg.Pool;
  redis: RedisClient;
  tokenSecret: string;
  rateLimits: { preview: RateLimitRule; join: RateLimitRule; keyPrefix?: string };
}

export const DEFAULT_RATE_LIMITS: ApiDeps['rateLimits'] = {
  preview: { limit: 60, windowSeconds: 60 },
  join: { limit: 20, windowSeconds: 60 },
};

const Name = z.string().trim().min(1).max(40);
const CreateOrderBody = z.object({ branchId: z.uuid(), name: Name });
const JoinBody = z.object({ name: Name, clientOpId: z.uuid().optional() });

/** Los códigos se aceptan en minúsculas; uno con formato inválido directamente no existe. */
function parseCode(raw: unknown): string {
  if (typeof raw !== 'string') throw orderNotFound();
  const code = raw.toUpperCase();
  if (!new RegExp(`^[A-Z0-9]{${CODE_LENGTH}}$`).test(code)) throw orderNotFound();
  return code;
}

export function apiRouter({ pool, redis, tokenSecret, rateLimits }: ApiDeps): Router {
  const limitPreview = rateLimit(redis, 'preview', rateLimits.preview, rateLimits.keyPrefix);
  const limitJoin = rateLimit(redis, 'join', rateLimits.join, rateLimits.keyPrefix);
  const tenantRouter = Router({ mergeParams: true });

  tenantRouter.get('/', (_req, res) => {
    const { slug, name, primaryColor, logoUrl } = res.locals.tenant;
    res.json({ slug, name, primaryColor, logoUrl });
  });

  tenantRouter.get('/branches', async (_req, res) => {
    res.json(await res.locals.catalog.listBranches());
  });

  tenantRouter.get('/menu', async (_req, res) => {
    res.json(await res.locals.catalog.listMenu());
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
    res.status(201).json({ code, participant, token });
  });

  tenantRouter.post('/orders/:code/join', limitJoin, async (req, res) => {
    const code = parseCode(req.params.code);
    const body = JoinBody.parse(req.body);
    const { orderId, participant } = await res.locals.orders.joinOrder(
      code,
      body.name,
      body.clientOpId ?? randomUUID(),
    );
    const token = signToken(
      { tenantId: res.locals.tenant.id, orderId, participantId: participant.id },
      tokenSecret,
    );
    res.status(201).json({ code, participant, token });
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
