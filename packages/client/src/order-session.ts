import type {
  ApiError,
  CommandAck,
  CommandInput,
  CommandName,
  OrderSnapshot,
} from '@pedido/shared';
import type { OrderStore } from './order-store.js';

/** Lo que la sesión necesita de la conexión (OrderConnection lo cumple; los tests usan un doble). */
export interface SessionTransport {
  readonly store: OrderStore;
  send<C extends CommandName>(command: C, payload: CommandInput<C>): Promise<CommandAck>;
  whenConnected(): Promise<void>;
}

export interface SessionOptions {
  /** Ventana de agrupamiento de toques sobre la misma línea (regla 9). */
  debounceMs?: number;
  /** Reintentos ante timeout/desconexión, siempre con el mismo clientOpId (regla 5). */
  maxAttempts?: number;
  newId?: () => string;
}

export interface Rejection extends ApiError {
  command: CommandName;
}

export interface MenuItemRef {
  id: string;
  name: string;
  priceCents: number;
}

type Apply = (state: OrderSnapshot) => OrderSnapshot;

interface PendingOp {
  clientOpId: string;
  apply: Apply;
  /** Versión confirmada por el server; se descarta cuando el store la alcanza. */
  ackVersion?: number;
}

interface DraftIncrement {
  op: PendingOp;
  itemId: string;
  delta: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Sesión de un participante sobre un pedido. La vista es el estado confirmado por el server
 * más las operaciones pendientes aplicadas encima (regla 1): si el server rechaza una operación,
 * se quita de la lista y la vista "revierte" sola; si llega un evento de otro, se recalcula.
 */
export class OrderSession {
  private pending: PendingOp[] = [];
  private drafts = new Map<string, DraftIncrement>();
  /** Líneas agregadas cuyo add todavía no se confirmó: los incrementos esperan a que se confirme. */
  private addsInFlight = new Map<string, Promise<unknown>>();
  private listeners = new Set<() => void>();
  private rejectListeners = new Set<(r: Rejection) => void>();
  private cachedView: OrderSnapshot | null = null;
  private cacheKey: unknown[] = [];
  private readonly debounceMs: number;
  private readonly maxAttempts: number;
  private readonly newId: () => string;

  constructor(
    private readonly transport: SessionTransport,
    readonly participantId: string,
    opts: SessionOptions = {},
  ) {
    this.debounceMs = opts.debounceMs ?? 300;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.newId = opts.newId ?? (() => crypto.randomUUID());
    transport.store.subscribe(() => {
      this.dropConfirmed();
      this.notify();
    });
    // El server emite a la sala antes de responder el ack: si el evento propio llega primero,
    // la operación ya está en el estado confirmado y no hay que aplicarla dos veces.
    transport.store.onApplied((event) => {
      this.pending = this.pending.filter((p) => p.clientOpId !== event.clientOpId);
    });
  }

  /** Estado a mostrar: confirmado + pendientes. Referencia estable mientras nada cambie. */
  get state(): OrderSnapshot | null {
    const confirmed = this.transport.store.state;
    const key = [confirmed, ...this.pending, ...[...this.drafts.values()].map((d) => d.delta)];
    if (key.length !== this.cacheKey.length || key.some((k, i) => k !== this.cacheKey[i])) {
      this.cacheKey = key;
      this.cachedView = confirmed
        ? withTotals(this.pending.reduce((s, op) => op.apply(s), confirmed))
        : null;
    }
    return this.cachedView;
  }

  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  /** Agrega una línea nueva. Devuelve su id (generado acá, así se puede operar sobre ella ya). */
  addItem(menuItem: MenuItemRef, { quantity = 1, notes = '' } = {}): string {
    const itemId = this.newId();
    const clientOpId = this.newId();
    const participantId = this.participantId;
    this.push({
      clientOpId,
      apply: (s) => ({
        ...s,
        items: [
          ...s.items,
          {
            id: itemId,
            participantId,
            menuItemId: menuItem.id,
            name: menuItem.name,
            unitPriceCents: menuItem.priceCents,
            quantity,
            notes,
          },
        ],
      }),
    });
    const sent = this.send('item:add', clientOpId, {
      clientOpId,
      itemId,
      menuItemId: menuItem.id,
      quantity,
      notes,
    }).finally(() => this.addsInFlight.delete(itemId));
    this.addsInFlight.set(itemId, sent);
    return itemId;
  }

  /**
   * Suma (o resta) sobre una línea propia. Se refleja al instante y los toques seguidos se envían
   * agrupados tras `debounceMs` sin actividad: cinco "+1" => un solo increment(+5).
   */
  increment(itemId: string, delta: number): void {
    const draft = this.drafts.get(itemId);
    if (draft) {
      draft.delta += delta;
      clearTimeout(draft.timer);
      draft.timer = setTimeout(() => void this.flushDraft(itemId), this.debounceMs);
      this.notify();
      return;
    }
    const clientOpId = this.newId();
    const created: DraftIncrement = {
      itemId,
      delta,
      timer: setTimeout(() => void this.flushDraft(itemId), this.debounceMs),
      op: {
        clientOpId,
        // Lee el delta del borrador en cada recálculo: los toques nuevos se suman sin crear ops.
        apply: (s) => changeQuantity(s, itemId, created.delta),
      },
    };
    this.drafts.set(itemId, created);
    this.push(created.op);
  }

  remove(itemId: string): void {
    this.cancelDraft(itemId);
    const clientOpId = this.newId();
    this.push({
      clientOpId,
      apply: (s) => ({ ...s, items: s.items.filter((i) => i.id !== itemId) }),
    });
    void this.afterAdd(itemId).then(() =>
      this.send('item:remove', clientOpId, { clientOpId, itemId }),
    );
  }

  setNotes(itemId: string, notes: string): void {
    const clientOpId = this.newId();
    this.push({
      clientOpId,
      apply: (s) => ({ ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, notes } : i)) }),
    });
    void this.afterAdd(itemId).then(() =>
      this.send('item:notes', clientOpId, { clientOpId, itemId, notes }),
    );
  }

  /** Cambios de estado del pedido: no son optimistas, la UI espera la confirmación. */
  async setStatus(command: 'order:lock' | 'order:unlock' | 'order:submit'): Promise<CommandAck> {
    await this.flush();
    const clientOpId = this.newId();
    return this.send(command, clientOpId, { clientOpId }, { optimistic: false });
  }

  /** Envía ya los incrementos agrupados que estén esperando el debounce. */
  async flush(): Promise<void> {
    await Promise.all([...this.drafts.keys()].map((id) => this.flushDraft(id)));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onReject(listener: (r: Rejection) => void): () => void {
    this.rejectListeners.add(listener);
    return () => this.rejectListeners.delete(listener);
  }

  dispose(): void {
    for (const d of this.drafts.values()) clearTimeout(d.timer);
    this.drafts.clear();
    this.listeners.clear();
    this.rejectListeners.clear();
  }

  // --- internos ---

  private async flushDraft(itemId: string) {
    const draft = this.drafts.get(itemId);
    if (!draft) return;
    clearTimeout(draft.timer);
    this.drafts.delete(itemId);
    // Congelamos el delta: a partir de acá los toques nuevos abren otro borrador.
    const delta = draft.delta;
    draft.op.apply = (s) => changeQuantity(s, itemId, delta);
    if (delta === 0) return this.discard(draft.op); // +1 y -1 se cancelaron: no hay nada que mandar
    await this.afterAdd(itemId);
    await this.send('item:increment', draft.op.clientOpId, {
      clientOpId: draft.op.clientOpId,
      itemId,
      delta: Math.max(-50, Math.min(50, delta)),
    });
  }

  private afterAdd(itemId: string): Promise<unknown> {
    return this.addsInFlight.get(itemId) ?? Promise.resolve();
  }

  private cancelDraft(itemId: string) {
    const draft = this.drafts.get(itemId);
    if (!draft) return;
    clearTimeout(draft.timer);
    this.drafts.delete(itemId);
    this.discard(draft.op);
  }

  private async send<C extends CommandName>(
    command: C,
    clientOpId: string,
    payload: CommandInput<C>,
    { optimistic = true } = {},
  ): Promise<CommandAck> {
    let lastError: ApiError = { code: 'INTERNAL', message: 'No se pudo enviar el cambio' };
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      let ack: CommandAck;
      try {
        ack = await this.transport.send(command, payload);
      } catch {
        // Timeout o desconexión: reintentamos con el MISMO clientOpId cuando vuelva la conexión;
        // si el primer intento sí llegó, el server lo detecta como duplicado.
        await this.transport.whenConnected();
        continue;
      }
      if (ack.ok) {
        const op = this.pending.find((p) => p.clientOpId === clientOpId);
        if (op) op.ackVersion = ack.version;
        this.dropConfirmed();
        this.notify();
        return ack;
      }
      if (ack.error.code === 'RATE_LIMITED') {
        lastError = ack.error;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      return this.reject(command, clientOpId, ack.error, optimistic, ack);
    }
    return this.reject(command, clientOpId, lastError, optimistic, {
      ok: false,
      error: lastError,
      version: null,
    });
  }

  private reject(
    command: CommandName,
    clientOpId: string,
    error: ApiError,
    optimistic: boolean,
    ack: CommandAck,
  ): CommandAck {
    // Rollback: se saca la operación pendiente y la vista vuelve al estado confirmado.
    this.pending = this.pending.filter((p) => p.clientOpId !== clientOpId);
    this.notify();
    // Los cambios de estado (cerrar/enviar) devuelven el ack a quien los llamó; no hace falta avisar.
    if (optimistic) for (const l of this.rejectListeners) l({ ...error, command });
    return ack;
  }

  private push(op: PendingOp) {
    this.pending.push(op);
    this.notify();
  }

  private discard(op: PendingOp) {
    this.pending = this.pending.filter((p) => p !== op);
    this.notify();
  }

  /** Quita las operaciones confirmadas cuyo evento ya está en el estado del store. */
  private dropConfirmed() {
    const version = this.transport.store.version ?? -1;
    const before = this.pending.length;
    this.pending = this.pending.filter((p) => p.ackVersion === undefined || p.ackVersion > version);
    if (this.pending.length !== before) this.cacheKey = [];
  }

  private notify() {
    for (const l of this.listeners) l();
  }
}

function changeQuantity(s: OrderSnapshot, itemId: string, delta: number): OrderSnapshot {
  return {
    ...s,
    items: s.items.flatMap((i) => {
      if (i.id !== itemId) return [i];
      const quantity = i.quantity + delta;
      return quantity > 0 ? [{ ...i, quantity }] : [];
    }),
  };
}

function withTotals(s: OrderSnapshot): OrderSnapshot {
  return { ...s, totalCents: s.items.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0) };
}

/** Total por participante (lo que paga cada uno). */
export function totalsByParticipant(s: OrderSnapshot): Map<string, number> {
  const totals = new Map<string, number>(s.participants.map((p) => [p.id, 0]));
  for (const i of s.items) {
    totals.set(i.participantId, (totals.get(i.participantId) ?? 0) + i.quantity * i.unitPriceCents);
  }
  return totals;
}
