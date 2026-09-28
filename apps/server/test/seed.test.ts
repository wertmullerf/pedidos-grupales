import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { config } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { seed } from '../src/db/seed.js';
import { uuidV5 } from '../src/db/uuid.js';

describe('uuidV5', () => {
  it('coincide con el vector de referencia (namespace DNS, "www.example.com")', () => {
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('es determinista', () => {
    expect(uuidV5('menu:hamburgueseria-test:Gaseosa')).toBe(
      uuidV5('menu:hamburgueseria-test:Gaseosa'),
    );
    expect(uuidV5('menu:hamburgueseria-test:Gaseosa')).not.toBe(uuidV5('menu:smashlab:Gaseosa'));
  });
});

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
      { slug: 'hamburgueseria-test', branches: 2, items: 7 },
      { slug: 'smashlab', branches: 2, items: 7 },
    ]);
  });

  it('usa UUIDs válidos según RFC (pasan z.uuid())', async () => {
    const { rows } = await pool.query<{ id: string }>(`
      SELECT id FROM tenants UNION ALL SELECT id FROM branches UNION ALL SELECT id FROM menu_items`);
    expect(rows).toHaveLength(2 + 4 + 14);
    for (const { id } of rows) expect(z.uuid().safeParse(id).success).toBe(true);
  });

  it('es idempotente', async () => {
    await seed(pool);
    const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM menu_items');
    expect(rows[0]!.n).toBe(14);
  });
});
