import type { RequestHandler } from 'express';
import type pg from 'pg';
import { OrderRepo } from '../orders/order-repo.js';
import { CatalogRepo, findTenantBySlug, type Tenant } from '../tenant/catalog-repo.js';
import { AppError } from './errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      tenant: Tenant;
      catalog: CatalogRepo;
      orders: OrderRepo;
    }
  }
}

/**
 * Resuelve la cadena desde `/t/:tenantSlug` y deja en res.locals repositorios ya atados a ella.
 * Los handlers nunca reciben un tenantId suelto: solo pueden consultar a través de estos repos (regla 10).
 */
export function resolveTenant(pool: pg.Pool): RequestHandler<{ tenantSlug: string }> {
  return async (req, res, next) => {
    const tenant = await findTenantBySlug(pool, req.params.tenantSlug);
    if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'Cadena inexistente');
    res.locals.tenant = tenant;
    res.locals.catalog = new CatalogRepo(pool, tenant.id);
    res.locals.orders = new OrderRepo(pool, tenant.id);
    next();
  };
}
