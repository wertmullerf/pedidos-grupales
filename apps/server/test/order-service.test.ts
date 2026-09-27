import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParticipantToken } from '../src/auth/token.js';
import { config } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { OrderRepo } from '../src/orders/order-repo.js';
import { OrderService } from '../src/orders/order-service.js';

const op = () => ({ clientOpId: randomUUID() });

describe('OrderService: mutaciones con concurrencia segura', () => {
  // Pool más grande que la cantidad de operaciones concurrentes de los tests.
  const pool = createPool(config.DATABASE_URL);
  let tenantId: string;
  let otherTenantId: string;
  let branchId: string;
  let menu: Record<string, { id: string; price_cents: number }>;
  let otherTenantMenuItem: string;
  let service: OrderService;
  let repo: OrderRepo;

  beforeAll(async () => {
    const tenants = await pool.query<{ slug: string; id: string }>('SELECT slug, id FROM tenants');
    const bySlug = Object.fromEntries(tenants.rows.map((t) => [t.slug, t.id]));
    tenantId = bySlug.brasaburg!;
    otherTenantId = bySlug.smashlab!;

    const branch = await pool.query<{ id: string }>(
      'SELECT id FROM branches WHERE tenant_id = $1 AND is_open ORDER BY name LIMIT 1',
      [tenantId],
    );
    branchId = branch.rows[0]!.id;

    const items = await pool.query<{ name: string; id: string; price_cents: number }>(
      'SELECT name, id, price_cents FROM menu_items WHERE tenant_id = $1',
      [tenantId],
    );
    menu = Object.fromEntries(items.rows.map((m) => [m.name, m]));

    const other = await pool.query<{ id: string }>(
      'SELECT id FROM menu_items WHERE tenant_id = $1 LIMIT 1',
      [otherTenantId],
    );
    otherTenantMenuItem = other.rows[0]!.id;

    service = new OrderService(pool, tenantId);
    repo = new OrderRepo(pool, tenantId);
  });
  afterAll(() => pool.end());

  /** Pedido con host y un invitado; devuelve los "tokens" ya verificados de ambos. */
  async function setupOrder() {
    const created = await repo.createOrder(branchId, 'Host');
    const guest = await repo.joinOrder(created.code, 'Invitado', randomUUID());
    const host: ParticipantToken = {
      tenantId,
      orderId: created.orderId,
      participantId: created.participant.id,
    };
    const guestActor: ParticipantToken = {
      tenantId,
      orderId: created.orderId,
      participantId: guest.participant.id,
    };
    return { code: created.code, orderId: created.orderId, host, guest: guestActor };
  }

  const snapshot = (code: string, orderId: string) => repo.getSnapshot(code, orderId);

  async function addBurger(actor: ParticipantToken, quantity = 1) {
    const res = await service.addItem(actor, {
      ...op(),
      menuItemId: menu['Brasa Clásica']!.id,
      quantity,
    });
    return (res.event.payload.item as { id: string }).id;
  }

  describe('agregar ítems', () => {
    it('crea una línea con el precio del menú y sube la versión', async () => {
      const { code, orderId, host } = await setupOrder();
      const res = await service.addItem(host, {
        ...op(),
        menuItemId: menu['Doble Ahumada']!.id,
        quantity: 2,
        notes: 'sin cebolla',
      });

      expect(res.status).toBe('applied');
      expect(res.event).toMatchObject({
        type: 'item_added',
        version: 2, // 1 = join del invitado
        payload: {
          by: host.participantId,
          item: {
            participantId: host.participantId,
            name: 'Doble Ahumada',
            unitPriceCents: menu['Doble Ahumada']!.price_cents,
            quantity: 2,
            notes: 'sin cebolla',
          },
        },
      });

      const snap = await snapshot(code, orderId);
      expect(snap.order.version).toBe(2);
      expect(snap.items).toHaveLength(1);
      expect(snap.totalCents).toBe(2 * menu['Doble Ahumada']!.price_cents);
    });

    it('el mismo producto agregado dos veces son dos líneas (p. ej. con notas distintas)', async () => {
      const { code, orderId, host } = await setupOrder();
      const menuItemId = menu['Brasa Clásica']!.id;
      await service.addItem(host, { ...op(), menuItemId });
      await service.addItem(host, { ...op(), menuItemId, notes: 'sin cebolla' });

      const snap = await snapshot(code, orderId);
      expect(snap.items.map((i) => i.notes)).toEqual(['', 'sin cebolla']);
    });

    it('el precio queda congelado aunque cambie el menú', async () => {
      const { code, orderId, host } = await setupOrder();
      const { id, price_cents } = menu['Gaseosa']!;
      await service.addItem(host, { ...op(), menuItemId: id, quantity: 3 });
      try {
        await pool.query('UPDATE menu_items SET price_cents = price_cents * 2 WHERE id = $1', [id]);
        const snap = await snapshot(code, orderId);
        expect(snap.items[0]!.unitPriceCents).toBe(price_cents);
        expect(snap.totalCents).toBe(3 * price_cents);
      } finally {
        await pool.query('UPDATE menu_items SET price_cents = $2 WHERE id = $1', [id, price_cents]);
      }
    });

    it('no se puede agregar un ítem del menú de otra cadena', async () => {
      const { code, orderId, host } = await setupOrder();
      await expect(
        service.addItem(host, { ...op(), menuItemId: otherTenantMenuItem }),
      ).rejects.toMatchObject({ code: 'MENU_ITEM_NOT_FOUND', status: 404 });

      const snap = await snapshot(code, orderId);
      expect(snap.items).toHaveLength(0);
      expect(snap.order.version).toBe(1); // el bump de versión se deshizo
    });

    it('no se puede agregar un ítem no disponible', async () => {
      const { host } = await setupOrder();
      await expect(
        service.addItem(host, { ...op(), menuItemId: menu['Aros de cebolla']!.id }),
      ).rejects.toMatchObject({ code: 'MENU_ITEM_UNAVAILABLE', status: 409 });
    });

    it('rechaza un token de otra cadena', async () => {
      const { host } = await setupOrder();
      const foreign = new OrderService(pool, otherTenantId);
      await expect(
        foreign.addItem(host, { ...op(), menuItemId: otherTenantMenuItem }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('valida el comando', async () => {
      const { host } = await setupOrder();
      await expect(
        service.addItem(host, { clientOpId: 'x', menuItemId: menu['Gaseosa']!.id }),
      ).rejects.toThrow();
      await expect(
        service.incrementItem(host, { ...op(), itemId: randomUUID(), delta: 0 }),
      ).rejects.toThrow();
    });
  });

  describe('concurrencia', () => {
    it('50 incrementos concurrentes sobre el mismo ítem terminan en la cantidad exacta', async () => {
      const { code, orderId, host } = await setupOrder();
      const itemId = await addBurger(host);

      // Medimos que de verdad corran en paralelo, en conexiones distintas del pool.
      const clients = new Set<unknown>();
      let checkedOut = 0;
      let maxCheckedOut = 0;
      const onAcquire = (client: unknown) => {
        clients.add(client);
        maxCheckedOut = Math.max(maxCheckedOut, ++checkedOut);
      };
      const onRelease = () => checkedOut--;
      pool.on('acquire', onAcquire).on('release', onRelease);

      const results = await Promise.all(
        Array.from({ length: 50 }, () =>
          service.incrementItem(host, { ...op(), itemId, delta: 1 }),
        ),
      );
      pool.off('acquire', onAcquire).off('release', onRelease);

      expect(pool.options.max).toBeGreaterThan(1);
      expect(clients.size).toBeGreaterThan(1);
      expect(maxCheckedOut).toBeGreaterThan(1);
      expect(results.every((r) => r.status === 'applied')).toBe(true);

      const snap = await snapshot(code, orderId);
      expect(snap.items[0]!.quantity).toBe(51);
      // join + add + 50 incrementos, sin versiones repetidas ni huecos.
      expect(snap.order.version).toBe(52);
      expect(results.map((r) => r.event.version).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 50 }, (_, i) => i + 3),
      );
    });

    it('incrementos concurrentes de dos participantes sobre sus propios ítems no se pisan', async () => {
      const { code, orderId, host, guest } = await setupOrder();
      const hostItem = await addBurger(host);
      const guestItem = await addBurger(guest);

      await Promise.all([
        ...Array.from({ length: 20 }, () =>
          service.incrementItem(host, { ...op(), itemId: hostItem, delta: 1 }),
        ),
        ...Array.from({ length: 15 }, () =>
          service.incrementItem(guest, { ...op(), itemId: guestItem, delta: 2 }),
        ),
      ]);

      const snap = await snapshot(code, orderId);
      const qty = Object.fromEntries(snap.items.map((i) => [i.id, i.quantity]));
      expect(qty[hostItem]).toBe(21);
      expect(qty[guestItem]).toBe(31);
    });

    it('los eventos quedan con versiones consecutivas desde 1', async () => {
      const { orderId, host, guest } = await setupOrder();
      const itemId = await addBurger(host);
      await Promise.all([
        service.incrementItem(host, { ...op(), itemId, delta: 1 }),
        service.addItem(guest, { ...op(), menuItemId: menu['Gaseosa']!.id }),
        service.updateNotes(host, { ...op(), itemId, notes: 'bien cocida' }),
      ]);
      const { rows } = await pool.query<{ version: number }>(
        'SELECT version FROM order_events WHERE order_id = $1 ORDER BY version',
        [orderId],
      );
      expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('propiedad de los ítems', () => {
    it('un participante no puede modificar ítems de otro', async () => {
      const { code, orderId, host, guest } = await setupOrder();
      const itemId = await addBurger(host, 2);
      const versionBefore = (await snapshot(code, orderId)).order.version;

      await expect(
        service.incrementItem(guest, { ...op(), itemId, delta: 5 }),
      ).rejects.toMatchObject({ code: 'NOT_OWNER', status: 403 });
      await expect(service.removeItem(guest, { ...op(), itemId })).rejects.toMatchObject({
        code: 'NOT_OWNER',
      });
      await expect(
        service.updateNotes(guest, { ...op(), itemId, notes: 'hackeado' }),
      ).rejects.toMatchObject({ code: 'NOT_OWNER' });

      const snap = await snapshot(code, orderId);
      expect(snap.items[0]).toMatchObject({ id: itemId, quantity: 2, notes: '' });
      expect(snap.order.version).toBe(versionBefore);
    });

    it('404 para un ítem inexistente', async () => {
      const { host } = await setupOrder();
      await expect(
        service.removeItem(host, { ...op(), itemId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND', status: 404 });
    });

    it('decrementar hasta 0 elimina la línea; remove y notas funcionan sobre ítems propios', async () => {
      const { code, orderId, host } = await setupOrder();
      const a = await addBurger(host, 2);
      const b = await addBurger(host, 1);

      const dec = await service.incrementItem(host, { ...op(), itemId: a, delta: -5 });
      expect(dec.event.payload).toMatchObject({ itemId: a, delta: -5, quantity: 0 });
      await service.updateNotes(host, { ...op(), itemId: b, notes: 'sin pepinos' });

      let snap = await snapshot(code, orderId);
      expect(snap.items).toEqual([expect.objectContaining({ id: b, notes: 'sin pepinos' })]);

      await service.removeItem(host, { ...op(), itemId: b });
      snap = await snapshot(code, orderId);
      expect(snap.items).toHaveLength(0);
    });
  });

  describe('idempotencia', () => {
    it('una operación repetida con el mismo clientOpId se aplica una sola vez', async () => {
      const { code, orderId, host } = await setupOrder();
      const itemId = await addBurger(host);
      const cmd = { clientOpId: randomUUID(), itemId, delta: 3 };

      const first = await service.incrementItem(host, cmd);
      const second = await service.incrementItem(host, cmd);

      expect(first.status).toBe('applied');
      expect(second.status).toBe('duplicate');
      expect(second.event).toEqual(first.event);

      const snap = await snapshot(code, orderId);
      expect(snap.items[0]!.quantity).toBe(4);
      expect(snap.order.version).toBe(first.event.version);
    });

    it('reintentos concurrentes con el mismo clientOpId: exactamente uno se aplica', async () => {
      const { code, orderId, host } = await setupOrder();
      const cmd = { clientOpId: randomUUID(), menuItemId: menu['Gaseosa']!.id };

      const results = await Promise.all(
        Array.from({ length: 8 }, () => service.addItem(host, cmd)),
      );
      expect(results.filter((r) => r.status === 'applied')).toHaveLength(1);
      expect(new Set(results.map((r) => r.event.version)).size).toBe(1);

      const snap = await snapshot(code, orderId);
      expect(snap.items).toHaveLength(1);
    });

    it('reusar un clientOpId para otra operación es un conflicto', async () => {
      const { host } = await setupOrder();
      const clientOpId = randomUUID();
      const itemId = (await service.addItem(host, { clientOpId, menuItemId: menu['Gaseosa']!.id }))
        .event.payload.item as { id: string };
      await expect(
        service.removeItem(host, { clientOpId, itemId: itemId.id }),
      ).rejects.toMatchObject({ code: 'CLIENT_OP_CONFLICT' });
    });

    it('removeItem repetido: el reintento es "duplicate", no ITEM_NOT_FOUND', async () => {
      const { code, orderId, host } = await setupOrder();
      const itemId = await addBurger(host);
      const cmd = { clientOpId: randomUUID(), itemId };

      const first = await service.removeItem(host, cmd);
      const second = await service.removeItem(host, cmd);
      expect(first.status).toBe('applied');
      expect(second).toEqual({ status: 'duplicate', event: first.event });

      const snap = await snapshot(code, orderId);
      expect(snap.items).toHaveLength(0);
      expect(snap.order.version).toBe(first.event.version);
    });

    it('updateNotes repetido se aplica una sola vez', async () => {
      const { code, orderId, host } = await setupOrder();
      const itemId = await addBurger(host);
      const cmd = { clientOpId: randomUUID(), itemId, notes: 'sin sal' };

      const results = await Promise.all([
        service.updateNotes(host, cmd),
        service.updateNotes(host, cmd),
        service.updateNotes(host, cmd),
      ]);
      expect(results.filter((r) => r.status === 'applied')).toHaveLength(1);

      const snap = await snapshot(code, orderId);
      expect(snap.items[0]!.notes).toBe('sin sal');
      expect(snap.order.version).toBe(results[0]!.event.version);
    });
  });

  describe('cierre del pedido', () => {
    it('solo el host puede cerrar', async () => {
      const { guest } = await setupOrder();
      await expect(service.lockOrder(guest, op())).rejects.toMatchObject({
        code: 'NOT_HOST',
        status: 403,
      });
    });

    it('las operaciones que llegan después del lock se rechazan', async () => {
      const { code, orderId, host, guest } = await setupOrder();
      const itemId = await addBurger(guest);
      await service.lockOrder(host, op());

      await expect(
        service.incrementItem(guest, { ...op(), itemId, delta: 1 }),
      ).rejects.toMatchObject({ code: 'ORDER_LOCKED', status: 409 });
      await expect(
        service.addItem(guest, { ...op(), menuItemId: menu['Gaseosa']!.id }),
      ).rejects.toMatchObject({ code: 'ORDER_LOCKED' });
      await expect(
        service.updateNotes(guest, { ...op(), itemId, notes: 'tarde' }),
      ).rejects.toMatchObject({ code: 'ORDER_LOCKED', status: 409 });
      await expect(service.removeItem(guest, { ...op(), itemId })).rejects.toMatchObject({
        code: 'ORDER_LOCKED',
        status: 409,
      });
      await expect(service.lockOrder(host, op())).rejects.toMatchObject({ code: 'ORDER_LOCKED' });

      const snap = await snapshot(code, orderId);
      expect(snap.order.status).toBe('locked');
      expect(snap.items[0]).toMatchObject({ id: itemId, quantity: 1, notes: '' });
    });

    it('lock en carrera con incrementos: cada incremento se aplica antes del lock o se rechaza', async () => {
      const { code, orderId, host, guest } = await setupOrder();
      const itemId = await addBurger(guest);

      const increments = Array.from({ length: 30 }, () =>
        service.incrementItem(guest, { ...op(), itemId, delta: 1 }).then(
          (r) => ({ ok: true as const, version: r.event.version }),
          (e) => ({ ok: false as const, code: e.code as string }),
        ),
      );
      const lock = service.lockOrder(host, op());
      const [lockResult, ...results] = await Promise.all([lock, ...increments]);

      const applied = results.filter((r) => r.ok);
      const rejected = results.filter((r) => !r.ok);
      expect(applied.length + rejected.length).toBe(30);
      expect(rejected.every((r) => !r.ok && r.code === 'ORDER_LOCKED')).toBe(true);
      // Todo lo aplicado quedó antes del lock en el orden de versiones.
      expect(applied.every((r) => r.ok && r.version < lockResult.event.version)).toBe(true);

      const snap = await snapshot(code, orderId);
      expect(snap.items[0]!.quantity).toBe(1 + applied.length);
      expect(snap.order.version).toBe(lockResult.event.version);
    });

    it('el host puede reabrir y después se puede volver a operar', async () => {
      const { host, guest } = await setupOrder();
      await service.lockOrder(host, op());
      await expect(service.unlockOrder(guest, op())).rejects.toMatchObject({ code: 'NOT_HOST' });
      await service.unlockOrder(host, op());
      await expect(addBurger(guest)).resolves.toBeDefined();
      await expect(service.unlockOrder(host, op())).rejects.toMatchObject({
        code: 'INVALID_STATUS',
      });
    });
  });

  describe('envío a la sucursal', () => {
    it('requiere el pedido cerrado y con ítems', async () => {
      const { host } = await setupOrder();
      await expect(service.submitOrder(host, op())).rejects.toMatchObject({
        code: 'INVALID_STATUS',
      });
      await service.lockOrder(host, op());
      await expect(service.submitOrder(host, op())).rejects.toMatchObject({
        code: 'EMPTY_ORDER',
      });
    });

    it('no se puede enviar a una sucursal cerrada', async () => {
      const { host } = await setupOrder();
      await addBurger(host);
      await service.lockOrder(host, op());
      await pool.query('UPDATE branches SET is_open = false WHERE id = $1', [branchId]);
      try {
        await expect(service.submitOrder(host, op())).rejects.toMatchObject({
          code: 'BRANCH_CLOSED',
        });
      } finally {
        await pool.query('UPDATE branches SET is_open = true WHERE id = $1', [branchId]);
      }
    });

    it('envía el pedido y después no admite más cambios', async () => {
      const { code, orderId, host } = await setupOrder();
      await addBurger(host);
      await service.lockOrder(host, op());
      const res = await service.submitOrder(host, op());
      expect(res.event.type).toBe('order_submitted');

      expect((await snapshot(code, orderId)).order.status).toBe('submitted');
      await expect(service.unlockOrder(host, op())).rejects.toMatchObject({
        code: 'INVALID_STATUS',
      });
    });
  });
});
