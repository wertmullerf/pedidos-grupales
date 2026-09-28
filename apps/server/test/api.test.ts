import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { signToken, TOKEN_TTL_SECONDS, verifyToken } from '../src/auth/token.js';
import { PARTICIPANT_COLORS } from '../src/orders/order-repo.js';
import { TEST_TOKEN_SECRET, useTestApp } from './helpers.js';

type Slug = 'hamburgueseria-test' | 'smashlab';

interface BranchDto {
  id: string;
  name: string;
  isOpen: boolean;
}

interface Created {
  code: string;
  token: string;
  participant: { id: string; name: string; color: string };
}

describe('API REST del pedido', () => {
  const ctx = useTestApp();
  const api = () => request(ctx.app);
  const branches: Record<Slug, BranchDto[]> = { 'hamburgueseria-test': [], smashlab: [] };
  let tenantIds: Record<string, string>;

  beforeAll(async () => {
    for (const slug of ['hamburgueseria-test', 'smashlab'] as const) {
      branches[slug] = (await api().get(`/api/t/${slug}/branches`)).body;
    }
    const { rows } = await ctx.pool.query<{ slug: string; id: string }>(
      'SELECT slug, id FROM tenants',
    );
    tenantIds = Object.fromEntries(rows.map((r) => [r.slug, r.id]));
  });

  const openBranch = (slug: Slug) => branches[slug].find((b) => b.isOpen)!;

  async function createOrder(slug: Slug = 'hamburgueseria-test', name = 'Ana'): Promise<Created> {
    const res = await api()
      .post(`/api/t/${slug}/orders`)
      .send({ branchId: openBranch(slug).id, name });
    expect(res.status).toBe(201);
    return res.body;
  }

  const snapshot = (slug: Slug, code: string, token?: string) => {
    const req = api().get(`/api/t/${slug}/orders/${code}/snapshot`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  describe('catálogo', () => {
    it('devuelve datos y branding de la cadena', async () => {
      const res = await api().get('/api/t/hamburgueseria-test');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        slug: 'hamburgueseria-test',
        name: 'Hamburguesería Test',
        primaryColor: '#D93A26',
        logoUrl: null,
      });
    });

    it('404 para una cadena inexistente', async () => {
      const res = await api().get('/api/t/no-existe/menu');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TENANT_NOT_FOUND');
    });

    it('cada cadena ve solo sus sucursales y su menú', async () => {
      expect(branches['hamburgueseria-test'].map((b) => b.name).sort()).toEqual([
        'Caballito',
        'Palermo',
      ]);
      const a = (await api().get('/api/t/hamburgueseria-test/menu')).body as { id: string }[];
      const b = (await api().get('/api/t/smashlab/menu')).body as { id: string }[];
      expect(a).toHaveLength(7);
      expect(b).toHaveLength(7);
      expect(a.some((item) => b.some((other) => other.id === item.id))).toBe(false);
    });
  });

  describe('crear pedido', () => {
    it('crea el pedido con un host y devuelve código y token firmado', async () => {
      const { code, token, participant } = await createOrder('hamburgueseria-test', 'Ana');
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      expect(participant).toMatchObject({ name: 'Ana', color: PARTICIPANT_COLORS[0] });
      expect(verifyToken(token, TEST_TOKEN_SECRET)).toMatchObject({
        tenantId: tenantIds['hamburgueseria-test'],
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
        .post('/api/t/hamburgueseria-test/orders')
        .send({ branchId: openBranch('smashlab').id, name: 'Ana' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('BRANCH_NOT_FOUND');
    });

    it('valida el body', async () => {
      const res = await api()
        .post('/api/t/hamburgueseria-test/orders')
        .send({ branchId: 'no-uuid', name: '   ' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('preview público', () => {
    it('muestra solo cadena, sucursal, host, cantidad de participantes y status', async () => {
      const host = await createOrder('hamburgueseria-test', 'Ana');
      await api()
        .post(`/api/t/hamburgueseria-test/orders/${host.code}/join`)
        .send({ name: 'Beto' });

      const res = await api().get(`/api/t/hamburgueseria-test/orders/${host.code.toLowerCase()}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        tenant: { slug: 'hamburgueseria-test', name: 'Hamburguesería Test' },
        branch: { name: openBranch('hamburgueseria-test').name, address: expect.any(String) },
        hostName: 'Ana',
        participantCount: 2,
        status: 'open',
      });
    });

    it('404 para un código inexistente o mal formado', async () => {
      expect((await api().get('/api/t/hamburgueseria-test/orders/ZZZZZZ')).status).toBe(404);
      expect((await api().get('/api/t/hamburgueseria-test/orders/abc')).status).toBe(404);
    });
  });

  describe('unirse y snapshot', () => {
    it('suma participantes con colores distintos y sube la versión', async () => {
      const host = await createOrder('hamburgueseria-test', 'Ana');

      const join = await api()
        .post(`/api/t/hamburgueseria-test/orders/${host.code.toLowerCase()}/join`)
        .send({ name: 'Beto' });
      expect(join.status).toBe(201);
      expect(join.body.participant).toMatchObject({ name: 'Beto', color: PARTICIPANT_COLORS[1] });

      // Cualquier participante del pedido puede ver el snapshot completo.
      for (const token of [host.token, join.body.token]) {
        const snap = await snapshot('hamburgueseria-test', host.code, token);
        expect(snap.status).toBe(200);
        expect(snap.body).toMatchObject({
          order: {
            code: host.code,
            status: 'open',
            version: 1,
            hostParticipantId: host.participant.id,
          },
          branch: { id: openBranch('hamburgueseria-test').id },
          items: [],
          totalCents: 0,
        });
        expect(snap.body.participants.map((p: { name: string }) => p.name)).toEqual([
          'Ana',
          'Beto',
        ]);
      }
    });

    it('el snapshot ordena a los participantes igual que los eventos, aun con joins concurrentes', async () => {
      const host = await createOrder();
      // Varios joins a la vez: el orden de inicio de las transacciones no es el orden de los locks.
      await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          api()
            .post(`/api/t/hamburgueseria-test/orders/${host.code}/join`)
            .send({ name: `P${i}` }),
        ),
      );
      const { rows } = await ctx.pool.query<{ id: string }>(
        `SELECT e.payload->'participant'->>'id' AS id
         FROM order_events e JOIN group_orders o ON o.id = e.order_id
         WHERE o.code = $1 AND e.type = 'participant_joined' ORDER BY e.version`,
        [host.code],
      );
      const snap = await snapshot('hamburgueseria-test', host.code, host.token);
      expect(snap.body.participants.map((p: { id: string }) => p.id)).toEqual([
        host.participant.id,
        ...rows.map((r) => r.id),
      ]);
    });

    it('unirse dos veces con el mismo clientOpId crea un solo participante', async () => {
      const host = await createOrder();
      const clientOpId = randomUUID();
      const join = () =>
        api()
          .post(`/api/t/hamburgueseria-test/orders/${host.code}/join`)
          .send({ name: 'Cata', clientOpId });
      const first = await join();
      const second = await join();

      expect(second.status).toBe(201);
      expect(second.body.participant).toEqual(first.body.participant);

      const snap = await snapshot('hamburgueseria-test', host.code, host.token);
      expect(snap.body.participants).toHaveLength(2);
      expect(snap.body.order.version).toBe(1);
    });

    it('no se puede unir a un pedido cerrado', async () => {
      const { code } = await createOrder();
      await ctx.pool.query(`UPDATE group_orders SET status = 'locked' WHERE code = $1`, [code]);
      const res = await api()
        .post(`/api/t/hamburgueseria-test/orders/${code}/join`)
        .send({ name: 'Dani' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_LOCKED');
    });
  });

  describe('snapshot completo: autenticación', () => {
    it('401 sin token o con token inválido', async () => {
      const { code } = await createOrder();
      expect((await snapshot('hamburgueseria-test', code)).status).toBe(401);
      expect((await snapshot('hamburgueseria-test', code, 'basura.basura')).status).toBe(401);
    });

    it('401 con token vencido', async () => {
      const host = await createOrder();
      const payload = verifyToken(host.token, TEST_TOKEN_SECRET)!;
      const expired = signToken(payload, TEST_TOKEN_SECRET, {
        now: Math.floor(Date.now() / 1000) - TOKEN_TTL_SECONDS - 1,
      });
      const res = await snapshot('hamburgueseria-test', host.code, expired);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('403 con el token de otro pedido de la misma cadena', async () => {
      const a = await createOrder();
      const b = await createOrder();
      const res = await snapshot('hamburgueseria-test', a.code, b.token);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('aislamiento multi-tenant', () => {
    it('el código de un pedido de la cadena A da 404 desde la cadena B', async () => {
      const host = await createOrder('hamburgueseria-test');

      const preview = await api().get(`/api/t/smashlab/orders/${host.code}`);
      expect(preview.status).toBe(404);
      expect(preview.body.error.code).toBe('ORDER_NOT_FOUND');

      const join = await api()
        .post(`/api/t/smashlab/orders/${host.code}/join`)
        .send({ name: 'Intruso' });
      expect(join.status).toBe(404);

      // Y el pedido original sigue intacto.
      const original = await snapshot('hamburgueseria-test', host.code, host.token);
      expect(original.body.participants).toHaveLength(1);
      expect(original.body.order.version).toBe(0);
    });

    it('un token de la cadena A es rechazado en la cadena B', async () => {
      const a = await createOrder('hamburgueseria-test');
      const b = await createOrder('smashlab');
      const res = await snapshot('smashlab', b.code, a.token);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });
});

describe('rate limit (Redis, compartido entre instancias)', () => {
  const rules = {
    preview: { limit: 3, windowSeconds: 60 },
    join: { limit: 2, windowSeconds: 60 },
  };
  const keyPrefix = `test-rl:${randomUUID()}`;
  // Dos apps independientes que comparten Redis simulan dos instancias detrás de nginx.
  const instanceA = useTestApp({ rateLimits: { ...rules, keyPrefix } });
  const instanceB = useTestApp({ rateLimits: { ...rules, keyPrefix } });

  it('responde 429 al superar el límite de preview, contando entre instancias', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    const get = (app: typeof instanceA.app) =>
      request(app).get('/api/t/hamburgueseria-test/orders/ZZZZZZ').set('X-Forwarded-For', ip);

    expect((await get(instanceA.app)).status).toBe(404);
    expect((await get(instanceB.app)).status).toBe(404);
    expect((await get(instanceA.app)).status).toBe(404);

    const limited = await get(instanceB.app);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // Otra IP no se ve afectada.
    const other = await request(instanceA.app)
      .get('/api/t/hamburgueseria-test/orders/ZZZZZZ')
      .set('X-Forwarded-For', '198.51.100.7');
    expect(other.status).toBe(404);
  });

  it('responde 429 al superar el límite de join', async () => {
    const ip = '192.0.2.44';
    const join = () =>
      request(instanceA.app)
        .post('/api/t/hamburgueseria-test/orders/ZZZZZZ/join')
        .set('X-Forwarded-For', ip)
        .send({ name: 'Bot' });
    expect((await join()).status).toBe(404);
    expect((await join()).status).toBe(404);
    expect((await join()).status).toBe(429);
  });
});
