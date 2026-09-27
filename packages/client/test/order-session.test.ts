import type {
  CommandAck,
  CommandInput,
  CommandName,
  OrderEvent,
  OrderSnapshot,
} from '@pedido/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderSession, type SessionTransport } from '../src/order-session.js';
import { OrderStore } from '../src/order-store.js';

const ME = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';
const MENU = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Brasa Clásica',
  priceCents: 950000,
};
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function snapshot(): OrderSnapshot {
  return {
    order: {
      id: ORDER,
      code: 'ABC234',
      status: 'open',
      version: 1,
      hostParticipantId: ME,
      createdAt: '',
      updatedAt: '',
    },
    branch: { id: uuid(), name: 'Sucursal', address: '', isOpen: true },
    participants: [{ id: ME, name: 'Ana', color: '#E03131' }],
    items: [],
    totalCents: 0,
  };
}

interface Sent {
  command: CommandName;
  payload: Record<string, unknown>;
  resolve: (ack: CommandAck) => void;
  reject: (err: Error) => void;
}

/** Doble del server: registra lo enviado y deja que el test decida cuándo y cómo responder. */
class FakeTransport implements SessionTransport {
  store = new OrderStore();
  sent: Sent[] = [];

  send<C extends CommandName>(command: C, payload: CommandInput<C>): Promise<CommandAck> {
    return new Promise((resolve, reject) =>
      this.sent.push({ command, payload: payload as Record<string, unknown>, resolve, reject }),
    );
  }

  whenConnected() {
    return Promise.resolve();
  }

  /** El server aplica el comando: emite el evento y responde el ack (en ese orden, como el real). */
  apply(sent: Sent, event: Omit<OrderEvent, 'orderId' | 'version' | 'clientOpId'>) {
    const version = this.store.version! + 1;
    const full = {
      ...event,
      orderId: ORDER,
      version,
      clientOpId: sent.payload.clientOpId as string,
    } as OrderEvent;
    this.store.applyEvent(full);
    sent.resolve({ ok: true, status: 'applied', version, event: full });
  }
}

describe('OrderSession', () => {
  let t: FakeTransport;
  let session: OrderSession;
  const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
    t = new FakeTransport();
    t.store.setSnapshot(snapshot());
    session = new OrderSession(t, ME, { newId: uuid });
  });
  afterEach(() => vi.useRealTimers());

  /** Agrega una línea y la confirma en el server. */
  async function addConfirmed() {
    const itemId = session.addItem(MENU);
    await flushMicrotasks();
    const add = t.sent.shift()!;
    t.apply(add, {
      type: 'item_added',
      payload: {
        by: ME,
        item: {
          id: itemId,
          participantId: ME,
          menuItemId: MENU.id,
          name: MENU.name,
          unitPriceCents: MENU.priceCents,
          quantity: 1,
          notes: '',
        },
      },
    } as OrderEvent);
    await flushMicrotasks();
    return itemId;
  }

  it('cinco "+1" seguidos se ven al instante y se envían como un solo increment(+5)', async () => {
    const itemId = await addConfirmed();

    for (let i = 0; i < 5; i++) {
      session.increment(itemId, 1);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(session.state!.items[0]!.quantity).toBe(6); // optimista, sin esperar al server
    expect(t.sent).toHaveLength(0); // todavía dentro de la ventana de debounce

    await vi.advanceTimersByTimeAsync(300);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ command: 'item:increment', payload: { itemId, delta: 5 } });

    t.apply(t.sent[0]!, {
      type: 'item_incremented',
      payload: { by: ME, itemId, delta: 5, quantity: 6 },
    } as OrderEvent);
    await flushMicrotasks();
    expect(session.state!.items[0]!.quantity).toBe(6); // confirmado, sin contarlo dos veces
    expect(session.hasPending).toBe(false);
  });

  it('+1 y -1 dentro de la ventana se cancelan y no se envía nada', async () => {
    const itemId = await addConfirmed();
    session.increment(itemId, 1);
    session.increment(itemId, -1);
    await vi.advanceTimersByTimeAsync(400);
    expect(t.sent).toHaveLength(0);
    expect(session.hasPending).toBe(false);
  });

  it('si el server rechaza, la vista revierte y se avisa con el código', async () => {
    const rejections: string[] = [];
    session.onReject((r) => rejections.push(r.code));

    session.addItem(MENU);
    expect(session.state!.items).toHaveLength(1);
    expect(session.state!.totalCents).toBe(MENU.priceCents);

    await flushMicrotasks();
    t.sent[0]!.resolve({
      ok: false,
      error: { code: 'ORDER_LOCKED', message: 'El pedido ya está cerrado' },
      version: 5,
    });
    await flushMicrotasks();

    expect(session.state!.items).toHaveLength(0);
    expect(session.state!.totalCents).toBe(0);
    expect(rejections).toEqual(['ORDER_LOCKED']);
  });

  it('los incrementos sobre una línea recién agregada esperan a que se confirme el add', async () => {
    const itemId = session.addItem(MENU);
    session.increment(itemId, 2);
    await vi.advanceTimersByTimeAsync(400);
    expect(t.sent.map((s) => s.command)).toEqual(['item:add']);
    expect(session.state!.items[0]!.quantity).toBe(3);

    t.apply(t.sent.shift()!, {
      type: 'item_added',
      payload: {
        by: ME,
        item: {
          id: itemId,
          participantId: ME,
          menuItemId: MENU.id,
          name: MENU.name,
          unitPriceCents: MENU.priceCents,
          quantity: 1,
          notes: '',
        },
      },
    } as OrderEvent);
    await flushMicrotasks();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ command: 'item:increment', payload: { itemId, delta: 2 } });
  });

  it('ante un timeout reintenta con el mismo clientOpId', async () => {
    session.addItem(MENU);
    await flushMicrotasks();
    const first = t.sent.shift()!;
    first.reject(new Error('operation has timed out'));
    await flushMicrotasks();

    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.payload.clientOpId).toBe(first.payload.clientOpId);
    expect(session.state!.items).toHaveLength(1); // sigue visible mientras reintenta
  });

  it('los eventos de otros se ven debajo de los cambios pendientes propios', async () => {
    const itemId = await addConfirmed();
    session.increment(itemId, 1);

    const other = '44444444-4444-4444-8444-444444444444';
    t.store.applyEvent({
      orderId: ORDER,
      version: t.store.version! + 1,
      clientOpId: uuid(),
      type: 'participant_joined',
      payload: { participant: { id: other, name: 'Beto', color: '#1971C2' } },
    });

    expect(session.state!.participants.map((p) => p.name)).toEqual(['Ana', 'Beto']);
    expect(session.state!.items[0]!.quantity).toBe(2);
  });
});
