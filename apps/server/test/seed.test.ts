import { afterAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { seed } from '../src/db/seed.js';

describe('seed', () => {
  const pool = createPool(config.DATABASE_URL);
  afterAll(() => pool.end());

  it('carga dos cadenas, cada una con 2 sucursales y su propio menú', async () => {
    const { rows } = await pool.query<{ slug: string; branches: number; items: number }>(`
      SELECT t.slug,
             (SELECT count(*)::int FROM branches b WHERE b.tenant_id = t.id)   AS branches,
             (SELECT count(*)::int FROM menu_items m WHERE m.tenant_id = t.id) AS items
      FROM tenants t ORDER BY t.slug`);
    expect(rows).toEqual([
      { slug: 'brasaburg', branches: 2, items: 7 },
      { slug: 'smashlab', branches: 2, items: 7 },
    ]);
  });

  it('es idempotente', async () => {
    await seed(pool);
    const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM menu_items');
    expect(rows[0]!.n).toBe(14);
  });
});
