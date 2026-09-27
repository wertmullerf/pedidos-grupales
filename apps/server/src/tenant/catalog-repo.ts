import type pg from 'pg';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  primaryColor: string;
  logoUrl: string | null;
}

export interface Branch {
  id: string;
  name: string;
  address: string;
  isOpen: boolean;
}

export interface MenuItem {
  id: string;
  category: string;
  name: string;
  description: string;
  priceCents: number;
  available: boolean;
}

export async function findTenantBySlug(pool: pg.Pool, slug: string): Promise<Tenant | null> {
  const { rows } = await pool.query<Tenant>(
    `SELECT id, slug, name, primary_color AS "primaryColor", logo_url AS "logoUrl"
     FROM tenants WHERE slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

/** Lecturas del catálogo de una cadena. Se construye con el tenant ya resuelto. */
export class CatalogRepo {
  constructor(
    private readonly pool: pg.Pool,
    private readonly tenantId: string,
  ) {}

  async listBranches(): Promise<Branch[]> {
    const { rows } = await this.pool.query<Branch>(
      `SELECT id, name, address, is_open AS "isOpen"
       FROM branches WHERE tenant_id = $1 ORDER BY name`,
      [this.tenantId],
    );
    return rows;
  }

  async listMenu(): Promise<MenuItem[]> {
    const { rows } = await this.pool.query<MenuItem>(
      `SELECT id, category, name, description, price_cents AS "priceCents", available
       FROM menu_items WHERE tenant_id = $1 ORDER BY category, name`,
      [this.tenantId],
    );
    return rows;
  }
}
