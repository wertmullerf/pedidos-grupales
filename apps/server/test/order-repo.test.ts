import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { generateCode, MAX_CODE_ATTEMPTS, OrderRepo } from '../src/orders/order-repo.js';

describe('OrderRepo.createOrder: colisión de códigos', () => {
  const pool = createPool(config.DATABASE_URL);
  let tenantId: string;
  let branchId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ tenant_id: string; id: string }>(
      `SELECT b.tenant_id, b.id FROM branches b JOIN tenants t ON t.id = b.tenant_id
       WHERE t.slug = 'hamburgueseria-test' AND b.is_open LIMIT 1`,
    );
    tenantId = rows[0]!.tenant_id;
    branchId = rows[0]!.id;
  });
  afterAll(() => pool.end());

  it('si el código choca con el UNIQUE, reintenta con uno nuevo', async () => {
    const existing = await new OrderRepo(pool, tenantId).createOrder(branchId, 'Ana');

    const fresh = generateCode();
    const sequence = [existing.code, existing.code, fresh];
    const generated: string[] = [];
    const repo = new OrderRepo(pool, tenantId, () => {
      const code = sequence[generated.length]!;
      generated.push(code);
      return code;
    });

    const created = await repo.createOrder(branchId, 'Beto');
    expect(generated).toEqual([existing.code, existing.code, fresh]);
    expect(created.code).toBe(fresh);
  });

  it(`se rinde después de ${MAX_CODE_ATTEMPTS} intentos`, async () => {
    const existing = await new OrderRepo(pool, tenantId).createOrder(branchId, 'Ana');
    let calls = 0;
    const repo = new OrderRepo(pool, tenantId, () => {
      calls++;
      return existing.code;
    });

    await expect(repo.createOrder(branchId, 'Beto')).rejects.toThrow('código de pedido único');
    expect(calls).toBe(MAX_CODE_ATTEMPTS);
  });
});
