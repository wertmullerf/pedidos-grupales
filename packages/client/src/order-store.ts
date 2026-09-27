import type { OrderEvent, OrderSnapshot } from '@pedido/shared';

/** Aplica un evento al estado. Pura: no valida versiones (eso lo hace OrderStore). */
export function reduceEvent(state: OrderSnapshot, event: OrderEvent): OrderSnapshot {
  let { participants, items } = state;
  let status = state.order.status;

  switch (event.type) {
    case 'participant_joined': {
      const { participant } = event.payload;
      if (!participants.some((x) => x.id === participant.id)) {
        participants = [...participants, participant];
      }
      break;
    }
    case 'item_added':
      items = [...items, event.payload.item];
      break;
    case 'item_incremented': {
      // El server manda la cantidad resultante; 0 significa que la línea se eliminó.
      const { itemId, quantity } = event.payload;
      items =
        quantity > 0
          ? items.map((i) => (i.id === itemId ? { ...i, quantity } : i))
          : items.filter((i) => i.id !== itemId);
      break;
    }
    case 'item_removed': {
      const { itemId } = event.payload;
      items = items.filter((i) => i.id !== itemId);
      break;
    }
    case 'item_notes_updated': {
      const { itemId, notes } = event.payload;
      items = items.map((i) => (i.id === itemId ? { ...i, notes } : i));
      break;
    }
    case 'order_locked':
      status = 'locked';
      break;
    case 'order_unlocked':
      status = 'open';
      break;
    case 'order_submitted':
      status = 'submitted';
      break;
  }

  return {
    ...state,
    order: { ...state.order, status, version: event.version },
    participants,
    items,
    totalCents: items.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0),
  };
}

export type ApplyResult = 'applied' | 'stale' | 'gap' | 'buffered';

const MAX_PENDING = 500;

/**
 * Estado autoritativo del pedido en el cliente. Aplica eventos estrictamente en orden de versión
 * (regla 8): un evento viejo se ignora, y uno adelantado se guarda y se informa como `gap` para
 * que la conexión pida resync en lugar de aplicarlo a ciegas.
 */
export class OrderStore {
  private current: OrderSnapshot | null = null;
  /** Eventos que llegaron antes de tiempo (antes del snapshot o después de un hueco), por versión. */
  private pending = new Map<number, OrderEvent>();
  private listeners = new Set<() => void>();
  private appliedListeners = new Set<(event: OrderEvent) => void>();

  get state(): OrderSnapshot | null {
    return this.current;
  }

  get version(): number | null {
    return this.current?.order.version ?? null;
  }

  setSnapshot(snapshot: OrderSnapshot): void {
    this.current = snapshot;
    this.drainPending();
    this.notify();
  }

  applyEvent(event: OrderEvent): ApplyResult {
    if (!this.current) {
      this.remember(event);
      return 'buffered';
    }
    const version = this.current.order.version;
    if (event.version <= version) return 'stale';
    if (event.version > version + 1) {
      this.remember(event);
      return 'gap';
    }
    this.reduce(event);
    this.drainPending();
    this.notify();
    return 'applied';
  }

  /** true si quedan eventos adelantados sin poder aplicar (sigue habiendo un hueco). */
  get hasGap(): boolean {
    return this.pending.size > 0;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Se llama con cada evento efectivamente aplicado, en orden de versión (para el panel de actividad). */
  onApplied(listener: (event: OrderEvent) => void): () => void {
    this.appliedListeners.add(listener);
    return () => this.appliedListeners.delete(listener);
  }

  private reduce(event: OrderEvent) {
    this.current = reduceEvent(this.current!, event);
    for (const l of this.appliedListeners) l(event);
  }

  private remember(event: OrderEvent) {
    if (this.pending.size < MAX_PENDING) this.pending.set(event.version, event);
  }

  private drainPending() {
    if (!this.current) return;
    for (const v of [...this.pending.keys()]) {
      if (v <= this.current.order.version) this.pending.delete(v);
    }
    let next = this.pending.get(this.current.order.version + 1);
    while (next) {
      this.pending.delete(next.version);
      this.reduce(next);
      next = this.pending.get(this.current.order.version + 1);
    }
  }

  private notify() {
    for (const l of this.listeners) l();
  }
}
