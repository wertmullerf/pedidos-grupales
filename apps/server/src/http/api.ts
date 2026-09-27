import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { signToken } from '../auth/token.js';
import { CODE_LENGTH, orderNotFound } from '../orders/order-repo.js';
import { resolveTenant } from './tenant.js';

const Name = z.string().trim().min(1).max(40);
const CreateOrderBody = z.object({ branchId: z.guid(), name: Name });
const JoinBody = z.object({ name: Name, clientOpId: z.guid().optional() });

/** Los códigos se aceptan en minúsculas; uno con formato inválido directamente no existe. */
function parseCode(raw: string): string {
  const code = raw.toUpperCase();
  if (!new RegExp(`^[A-Z0-9]{${CODE_LENGTH}}$`).test(code)) throw orderNotFound();
  return code;
}

export function apiRouter(pool: pg.Pool, tokenSecret: string): Router {
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

  tenantRouter.post('/orders/:code/join', async (req, res) => {
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

  tenantRouter.get('/orders/:code', async (req, res) => {
    res.json(await res.locals.orders.getSnapshot(parseCode(req.params.code)));
  });

  const router = Router();
  router.use('/t/:tenantSlug', resolveTenant(pool), tenantRouter);
  return router;
}
