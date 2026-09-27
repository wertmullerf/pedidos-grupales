import { randomUUID } from 'node:crypto';
import { ConnectionError, OrderConnection } from '@pedido/client';
import type { OrderSnapshot } from '@pedido/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { signToken, verifyToken } from '../src/auth/token.js';
import { config } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { OrderService } from '../src/orders/order-service.js';
import { connectRedis, type RedisClient } from '../src/redis.js';
import { startServer, type ServerDeps } from '../src/server.js';
import { addedItemId, TEST_TOKEN_SECRET } from './helpers.js';

type Instance = Awaited<ReturnType<typeof startServer>> & { name: string };

const MAX_RESYNC_EVENTS = 5;

/** Una instancia real: su propio pool, su propio Redis, su propio Socket.IO. Solo comparten Redis/DB. */
async function startInstance(name: string, overrides: Partial<ServerDeps> = {}) {
  const pool = createPool(config.DATABASE_URL);
  const redis = await connectRedis(config.REDIS_URL);
  const server = await startServer(
    {
      pool,
      redis,
      instanceId: name,
      tokenSecret: TEST_TOKEN_SECRET,
      rateLimits: {
        preview: { limit: 10_000, windowSeconds: 60 },
        join: { limit: 10_000, windowSeconds: 60 },
        keyPrefix: `test-rl:${randomUUID()}`,
      },
      realtime: { maxResyncEvents: MAX_RESYNC_EVENTS },
      ...overrides,
    },
    0,
  );
  return {
    ...server,
    name,
    close: async () => {
      await server.close();
      await Promise.allSettled([pool.end(), redis.quit()]);
    },
  } satisfies Instance;
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 4000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

/** Lo que tiene que coincidir entre clientes y server (sin timestamps). */
function normalize(s: OrderSnapshot | null) {
  if (!s) return null;
  return {
    version: s.order.version,
    status: s.order.status,
    participants: s.participants.map(({ id, name, color }) => ({ id, name, color })),
    items: s.items,
    totalCents: s.totalCents,
  };
}

describe('tiempo real', () => {
  let server1: Instance;
  let server2: Instance;
  const pool = createPool(config.DATABASE_URL);
  let redis: RedisClient;
  let branchId: string;
  let menuItemId: string;
  let tenantId: string;
  const connections: OrderConnection[] = [];

  beforeAll(async () => {
    [server1, server2] = await Promise.all([startInstance('server-1'), startInstance('server-2')]);
    redis = await connectRedis(config.REDIS_URL);
    const { rows } = await pool.query<{ tenant_id: string; branch: string; item: string }>(
      `SELECT t.id AS tenant_id,
              (SELECT id FROM branches WHERE tenant_id = t.id AND is_open LIMIT 1) AS branch,
              (SELECT id FROM menu_items WHERE tenant_id = t.id AND available LIMIT 1) AS item
       FROM tenants t WHERE t.slug = 'brasaburg'`,
    );
    ({ tenant_id: tenantId, branch: branchId, item: menuItemId } = rows[0]!);
  });

  afterEach(() => {
    for (const c of connections.splice(0)) c.close();
  });

  afterAll(async () => {
    await Promise.all([server1.close(), server2.close()]);
    await Promise.allSettled([pool.end(), redis.quit()]);
  });

  function connectTo(instance: Instance, token: string, tenantSlug = 'brasaburg') {
    const c = new OrderConnection({ url: instance.url, tenantSlug, token });
    connections.push(c);
    return c;
  }

  /** Host crea el pedido en server-1, el invitado se une en server-2, y cada uno se conecta a "su" instancia. */
  async function setup() {
    const created = await request(server1.url)
      .post('/api/t/brasaburg/orders')
      .send({ branchId, name: 'Ana' });
    const joined = await request(server2.url)
      .post(`/api/t/brasaburg/orders/${created.body.code}/join`)
      .send({ name: 'Beto' });
    const host = connectTo(server1, created.body.token);
    const guest = connectTo(server2, joined.body.token);
    await Promise.all([host.connect(), guest.connect()]);
    return {
      code: created.body.code as string,
      hostToken: created.body.token as string,
      guestToken: joined.body.token as string,
      host,
      guest,
    };
  }

  async function serverSnapshot(code: string, token: string) {
    const res = await request(server1.url)
      .get(`/api/t/brasaburg/orders/${code}/snapshot`)
      .set('Authorization', `Bearer ${token}`);
    return res.body as OrderSnapshot;
  }

  const add = (c: OrderConnection) =>
    c.send('item:add', { clientOpId: randomUUID(), menuItemId, quantity: 1 });

  describe('sincronización entre instancias (Redis adapter)', () => {
    it('dos clientes conectados a instancias distintas ven los mismos eventos', async () => {
      const { code, hostToken, host, guest } = await setup();
      // Cada instancia tiene exactamente un socket: lo que ve el otro cliente tuvo que pasar por Redis.
      expect(server1.realtime.io.of('/').sockets.size).toBe(1);
      expect(server2.realtime.io.of('/').sockets.size).toBe(1);

      const a = await add(host);
      const b = await add(guest);
      if (!a.ok || !b.ok) throw new Error('add falló');
      const hostItem = addedItemId(a.event);
      const guestItem = addedItemId(b.event);
      await host.send('item:increment', { clientOpId: randomUUID(), itemId: hostItem, delta: 2 });
      await guest.send('item:notes', {
        clientOpId: randomUUID(),
        itemId: guestItem,
        notes: 'sin cebolla',
      });

      const expected = normalize(await serverSnapshot(code, hostToken));
      expect(expected!.version).toBe(5);
      await waitFor(
        () => host.store.version === 5 && guest.store.version === 5,
        'ambos clientes en la versión 5',
      );
      expect(normalize(host.store.state)).toEqual(expected);
      expect(normalize(guest.store.state)).toEqual(expected);
      // Ninguno necesitó resync: todo llegó en vivo y en orden.
      expect(host.stats.resyncs).toBe(1); // el resync inicial al conectar
      expect(guest.stats.resyncs).toBe(1);
    });

    it('un participante que se une por REST aparece en vivo para los conectados', async () => {
      const { code, host, guest } = await setup();
      await request(server2.url)
        .post(`/api/t/brasaburg/orders/${code}/join`)
        .send({ name: 'Cata' });
      await waitFor(
        () => host.store.state?.participants.length === 3,
        'host ve al tercer participante',
      );
      await waitFor(
        () => guest.store.state?.participants.length === 3,
        'invitado ve al tercer participante',
      );
    });
  });

  describe('autenticación del handshake', () => {
    it('rechaza un token de otra cadena al unirse', async () => {
      const created = await request(server1.url)
        .post('/api/t/brasaburg/orders')
        .send({ branchId, name: 'Ana' });
      const intruder = connectTo(server2, created.body.token, 'smashlab');
      await expect(intruder.connect()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(server2.realtime.io.of('/').sockets.size).toBe(0);
    });

    it('rechaza sin token, con token vencido y con cadena inexistente', async () => {
      const created = await request(server1.url)
        .post('/api/t/brasaburg/orders')
        .send({ branchId, name: 'Ana' });
      const expired = signToken(
        verifyToken(created.body.token, TEST_TOKEN_SECRET)!,
        TEST_TOKEN_SECRET,
        {
          now: Math.floor(Date.now() / 1000) - 2 * 24 * 3600,
        },
      );

      await expect(connectTo(server1, '').connect()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      await expect(connectTo(server1, expired).connect()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      await expect(
        connectTo(server1, created.body.token, 'no-existe').connect(),
      ).rejects.toBeInstanceOf(ConnectionError);
    });
  });

  describe('resync (reglas 7 y 8)', () => {
    it('un evento perdido se detecta por el salto de versión y se resuelve con resync', async () => {
      const { code, hostToken, guestToken, host, guest } = await setup();
      const resyncsBefore = host.stats.resyncs;

      // "Evento perdido": se aplica en la DB pero nunca se emite a la sala (como si fallara el emit).
      const guestActor = verifyToken(guestToken, TEST_TOKEN_SECRET)!;
      await new OrderService(pool, tenantId).addItem(guestActor, {
        clientOpId: randomUUID(),
        menuItemId,
        quantity: 3,
      });
      const lostVersion = 2;
      await new Promise((r) => setTimeout(r, 100));
      expect(host.store.version).toBe(lostVersion - 1); // el host no se enteró

      // El siguiente evento llega con versión 3: el host ve el hueco y pide resync.
      await add(guest);
      const expected = normalize(await serverSnapshot(code, hostToken));
      await waitFor(() => host.store.version === 3, 'host resincronizado a la versión 3');
      expect(normalize(host.store.state)).toEqual(expected);
      expect(host.stats.resyncs).toBe(resyncsBefore + 1);
      expect(host.stats.lastResyncMode).toBe('events');
    });

    it('al reconectar pide los eventos desde la última versión vista', async () => {
      const { code, hostToken, host, guest } = await setup();
      host.disconnect();
      await waitFor(() => host.status === 'reconnecting', 'host desconectado');

      for (let i = 0; i < 3; i++) await add(guest);
      host.reconnect();

      await waitFor(() => host.status === 'resynced', 'host resincronizado');
      expect(host.stats.lastResyncMode).toBe('events');
      expect(normalize(host.store.state)).toEqual(normalize(await serverSnapshot(code, hostToken)));
    });

    it('si el hueco es muy grande recibe un snapshot completo', async () => {
      const { code, hostToken, host, guest } = await setup();
      host.disconnect();
      await waitFor(() => host.status === 'reconnecting', 'host desconectado');

      for (let i = 0; i < MAX_RESYNC_EVENTS + 3; i++) await add(guest);
      host.reconnect();

      await waitFor(() => host.status === 'resynced', 'host resincronizado');
      expect(host.stats.lastResyncMode).toBe('snapshot');
      expect(normalize(host.store.state)).toEqual(normalize(await serverSnapshot(code, hostToken)));
    });
  });

  describe('respuestas del server', () => {
    it('los errores incluyen la versión actual del pedido', async () => {
      const { host, guest } = await setup();
      await add(guest);

      const notHost = await guest.send('order:lock', { clientOpId: randomUUID() });
      expect(notHost).toMatchObject({ ok: false, error: { code: 'NOT_HOST' }, version: 2 });

      await host.send('order:lock', { clientOpId: randomUUID() });
      const locked = await guest.send('item:add', { clientOpId: randomUUID(), menuItemId });
      expect(locked).toMatchObject({ ok: false, error: { code: 'ORDER_LOCKED' }, version: 3 });

      const invalid = await guest.send('item:increment', {
        clientOpId: 'x',
        itemId: 'y',
        delta: 1,
      });
      expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' }, version: 3 });
    });

    it('un comando duplicado responde "duplicate" y no se vuelve a emitir', async () => {
      const { host, guest } = await setup();
      const received: number[] = [];
      guest.socket.on('order:event', (e: { version: number }) => received.push(e.version));

      const cmd = { clientOpId: randomUUID(), menuItemId, quantity: 1 };
      const first = await host.send('item:add', cmd);
      const second = await host.send('item:add', cmd);
      expect(first).toMatchObject({ ok: true, status: 'applied', version: 2 });
      expect(second).toMatchObject({ ok: true, status: 'duplicate', version: 2 });

      await add(host); // versión 3: si llegó, ya llegó todo lo anterior
      await waitFor(() => received.includes(3), 'invitado recibe la versión 3');
      expect(received).toEqual([2, 3]);
    });
  });

  describe('presencia', () => {
    it('conectados y "está eligiendo" se comparten entre instancias sin tocar la DB ni la versión', async () => {
      const { code, hostToken, host, guest } = await setup();
      const hostId = verifyToken(hostToken, TEST_TOKEN_SECRET)!.participantId;
      const versionBefore = (await serverSnapshot(code, hostToken)).order.version;

      await waitFor(() => host.presence.participants.length === 2, 'host ve 2 conectados');

      guest.setChoosing(true);
      await waitFor(
        () => host.presence.participants.some((p) => p.participantId !== hostId && p.choosing),
        'host ve al invitado eligiendo',
      );
      guest.setChoosing(false);
      await waitFor(() => host.presence.participants.every((p) => !p.choosing), 'nadie eligiendo');

      guest.close();
      await waitFor(
        () =>
          host.presence.participants.length === 1 &&
          host.presence.participants[0]!.participantId === hostId,
        'host ve que el invitado se fue',
      );

      expect((await serverSnapshot(code, hostToken)).order.version).toBe(versionBefore);
      expect(host.store.version).toBe(versionBefore);
    });
  });

  describe('rate limit por conexión', () => {
    it('descarta los eventos que exceden el límite y responde RATE_LIMITED', async () => {
      const limited = await startInstance('server-limitado', {
        realtime: { socketRateLimit: { capacity: 6, refillPerSecond: 0.01 }, maxResyncEvents: 200 },
      });
      try {
        const created = await request(limited.url)
          .post('/api/t/brasaburg/orders')
          .send({ branchId, name: 'Ana' });
        const c = connectTo(limited, created.body.token);
        await c.connect(); // consume 1 (el resync inicial)

        const acks = await Promise.all(Array.from({ length: 12 }, () => add(c)));
        const ok = acks.filter((a) => a.ok);
        const rejected = acks.filter((a) => !a.ok);
        expect(ok).toHaveLength(5);
        expect(rejected).toHaveLength(7);
        for (const r of rejected) {
          expect(r).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' }, version: null });
        }
        expect(normalize(c.store.state)!.items).toHaveLength(5);
      } finally {
        await limited.close();
      }
    });
  });
});
