import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { createPool } from '../src/db/pool.js';

// La integridad multi-tenant no depende solo del código: la DB rechaza las mezclas.
describe('schema: FKs compuestas por tenant', () => {
  const pool = createPool(config.DATABASE_URL);
  let a: { tenant: string; branch: string; menuItem: string };
  let b: { tenant: string; branch: string; menuItem: string };

  async function tenantFixture(slug: string) {
    const { rows } = await pool.query<{ tenant: string; branch: string; menu_item: string }>(
      `SELECT t.id AS tenant,
              (SELECT id FROM branches WHERE tenant_id = t.id LIMIT 1)   AS branch,
              (SELECT id FROM menu_items WHERE tenant_id = t.id LIMIT 1) AS menu_item
       FROM tenants t WHERE t.slug = $1`,
      [slug],
    );
    const r = rows[0]!;
    return { tenant: r.tenant, branch: r.branch, menuItem: r.menu_item };
  }

  beforeAll(async () => {
    a = await tenantFixture('hamburgueseria-test');
    b = await tenantFixture('smashlab');
  });
  afterAll(() => pool.end());

  async function insertOrder(tenant: string, branch: string) {
    const orderId = randomUUID();
    const participantId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO group_orders (id, tenant_id, branch_id, code, host_participant_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, tenant, branch, randomUUID().slice(0, 6).toUpperCase(), participantId],
      );
      await client.query(
        `INSERT INTO participants (id, order_id, name, color) VALUES ($1, $2, 'Test', '#000')`,
        [participantId, orderId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return { orderId, participantId };
  }

  it('no permite un pedido de la cadena A en una sucursal de la cadena B', async () => {
    await expect(insertOrder(a.tenant, b.branch)).rejects.toMatchObject({ code: '23503' });
  });

  it('no permite agregar a un pedido de A un ítem del menú de B', async () => {
    const { orderId, participantId } = await insertOrder(a.tenant, a.branch);
    const insertItem = (tenant: string, menuItem: string) =>
      pool.query(
        `INSERT INTO order_items (tenant_id, order_id, participant_id, menu_item_id, unit_price_cents, quantity)
         VALUES ($1, $2, $3, $4, 100, 1)`,
        [tenant, orderId, participantId, menuItem],
      );

    await expect(insertItem(a.tenant, b.menuItem)).rejects.toMatchObject({ code: '23503' });
    await expect(insertItem(b.tenant, b.menuItem)).rejects.toMatchObject({ code: '23503' });
    await expect(insertItem(a.tenant, a.menuItem)).resolves.toBeDefined();
  });
});
