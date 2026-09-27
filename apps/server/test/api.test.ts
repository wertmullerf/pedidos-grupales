import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyToken } from '../src/auth/token.js';
import { PARTICIPANT_COLORS } from '../src/orders/order-repo.js';
import { TEST_TOKEN_SECRET, useTestApp } from './helpers.js';

interface BranchDto {
  id: string;
  name: string;
  isOpen: boolean;
}

describe('API REST del pedido', () => {
  const ctx = useTestApp();
  const api = () => request(ctx.app);
  const branches: Record<'brasaburg' | 'smashlab', BranchDto[]> = { brasaburg: [], smashlab: [] };
  let tenantIds: Record<string, string>;

  beforeAll(async () => {
    for (const slug of ['brasaburg', 'smashlab'] as const) {
      branches[slug] = (await api().get(`/api/t/${slug}/branches`)).body;
    }
    const { rows } = await ctx.pool.query<{ slug: string; id: string }>(
      'SELECT slug, id FROM tenants',
    );
    tenantIds = Object.fromEntries(rows.map((r) => [r.slug, r.id]));
  });

  const openBranch = (slug: 'brasaburg' | 'smashlab') => branches[slug].find((b) => b.isOpen)!;

  async function createOrder(slug: 'brasaburg' | 'smashlab' = 'brasaburg', name = 'Ana') {
    const res = await api()
      .post(`/api/t/${slug}/orders`)
      .send({ branchId: openBranch(slug).id, name });
    expect(res.status).toBe(201);
    return res.body as { code: string; token: string; participant: { id: string } };
  }

  describe('catálogo', () => {
    it('devuelve datos y branding de la cadena', async () => {
      const res = await api().get('/api/t/brasaburg');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        slug: 'brasaburg',
        name: 'Brasaburg',
        primaryColor: '#D9480F',
        logoUrl: '/logos/brasaburg.svg',
      });
    });

    it('404 para una cadena inexistente', async () => {
      const res = await api().get('/api/t/no-existe/menu');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TENANT_NOT_FOUND');
    });

    it('cada cadena ve solo sus sucursales y su menú', async () => {
      expect(branches.brasaburg.map((b) => b.name).every((n) => n.startsWith('Brasaburg'))).toBe(
        true,
      );
      const a = (await api().get('/api/t/brasaburg/menu')).body as { id: string }[];
      const b = (await api().get('/api/t/smashlab/menu')).body as { id: string }[];
      expect(a).toHaveLength(7);
      expect(b).toHaveLength(7);
      expect(a.some((item) => b.some((other) => other.id === item.id))).toBe(false);
    });
  });

  describe('crear pedido', () => {
    it('crea el pedido con un host y devuelve código y token firmado', async () => {
      const { code, token, participant } = await createOrder('brasaburg', 'Ana');
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      expect(participant).toMatchObject({ name: 'Ana', color: PARTICIPANT_COLORS[0] });

      const payload = verifyToken(token, TEST_TOKEN_SECRET);
      expect(payload).toMatchObject({
        tenantId: tenantIds.brasaburg,
        participantId: participant.id,
      });
    });

    it('rechaza una sucursal cerrada', async () => {
      const closed = branches.smashlab.find((b) => !b.isOpen)!;
      const res = await api()
        .post('/api/t/smashlab/orders')
        .send({ branchId: closed.id, name: 'Ana' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('BRANCH_CLOSED');
    });

    it('rechaza una sucursal de otra cadena como inexistente', async () => {
      const res = await api()
        .post('/api/t/brasaburg/orders')
        .send({ branchId: openBranch('smashlab').id, name: 'Ana' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('BRANCH_NOT_FOUND');
    });

    it('valida el body', async () => {
      const res = await api()
        .post('/api/t/brasaburg/orders')
        .send({ branchId: 'no-uuid', name: '   ' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('unirse y snapshot', () => {
    it('suma participantes con colores distintos y sube la versión', async () => {
      const host = await createOrder('brasaburg', 'Ana');

      const join = await api()
        .post(`/api/t/brasaburg/orders/${host.code.toLowerCase()}/join`)
        .send({ name: 'Beto' });
      expect(join.status).toBe(201);
      expect(join.body.participant).toMatchObject({ name: 'Beto', color: PARTICIPANT_COLORS[1] });
      expect(verifyToken(join.body.token, TEST_TOKEN_SECRET)).toMatchObject({
        participantId: join.body.participant.id,
      });

      const snap = await api().get(`/api/t/brasaburg/orders/${host.code}`);
      expect(snap.status).toBe(200);
      expect(snap.body).toMatchObject({
        order: {
          code: host.code,
          status: 'open',
          version: 1,
          hostParticipantId: host.participant.id,
        },
        branch: { id: openBranch('brasaburg').id },
        items: [],
        totalCents: 0,
      });
      expect(snap.body.participants.map((p: { name: string }) => p.name)).toEqual(['Ana', 'Beto']);
    });

    it('unirse dos veces con el mismo clientOpId crea un solo participante', async () => {
      const { code } = await createOrder();
      const clientOpId = randomUUID();
      const first = await api()
        .post(`/api/t/brasaburg/orders/${code}/join`)
        .send({ name: 'Cata', clientOpId });
      const second = await api()
        .post(`/api/t/brasaburg/orders/${code}/join`)
        .send({ name: 'Cata', clientOpId });

      expect(second.status).toBe(201);
      expect(second.body.participant).toEqual(first.body.participant);

      const snap = await api().get(`/api/t/brasaburg/orders/${code}`);
      expect(snap.body.participants).toHaveLength(2);
      expect(snap.body.order.version).toBe(1);
    });

    it('no se puede unir a un pedido cerrado', async () => {
      const { code } = await createOrder();
      await ctx.pool.query(`UPDATE group_orders SET status = 'locked' WHERE code = $1`, [code]);
      const res = await api().post(`/api/t/brasaburg/orders/${code}/join`).send({ name: 'Dani' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_LOCKED');
    });

    it('404 para un código inexistente o mal formado', async () => {
      expect((await api().get('/api/t/brasaburg/orders/ZZZZZZ')).status).toBe(404);
      expect((await api().get('/api/t/brasaburg/orders/abc')).status).toBe(404);
    });
  });

  describe('aislamiento multi-tenant', () => {
    it('el código de un pedido de la cadena A da 404 desde la cadena B', async () => {
      const { code } = await createOrder('brasaburg');

      const snap = await api().get(`/api/t/smashlab/orders/${code}`);
      expect(snap.status).toBe(404);
      expect(snap.body.error.code).toBe('ORDER_NOT_FOUND');

      const join = await api()
        .post(`/api/t/smashlab/orders/${code}/join`)
        .send({ name: 'Intruso' });
      expect(join.status).toBe(404);

      // Y el pedido original sigue intacto.
      const original = await api().get(`/api/t/brasaburg/orders/${code}`);
      expect(original.body.participants).toHaveLength(1);
      expect(original.body.order.version).toBe(0);
    });
  });
});
