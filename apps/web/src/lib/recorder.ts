// Instrumentación para grabar la demo: solo se activa si el navegador trae window.__pgRecord
// (lo inyecta Playwright). Registra cuándo se aplica y se PINTA cada cambio, en milisegundos
// epoch, para medir la latencia real de sincronización entre pantallas.

export interface RecordEntry {
  kind: 'applied' | 'painted';
  version: number;
  type: string;
  by: string | null;
  itemId: string | null;
  rect?: { x: number; y: number; width: number; height: number };
  /** Qué quedó marcado en pantalla: la línea del pedido o, si no está visible, el total del grupo. */
  target?: 'line' | 'total';
}

declare global {
  interface Window {
    __pgRecord?: (RecordEntry & { t: number })[];
  }
}

const now = () => performance.timeOrigin + performance.now();

export function recording(): boolean {
  return typeof window !== 'undefined' && Array.isArray(window.__pgRecord);
}

export function record(entry: RecordEntry) {
  window.__pgRecord?.push({ ...entry, t: now() });
}

/** Registra cuándo la línea quedó pintada en pantalla (dos frames después de aplicar el evento). */
export function recordPaint(entry: Omit<RecordEntry, 'kind' | 'rect'>) {
  if (!recording()) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const visible = (el: HTMLElement | null) => (el && el.offsetParent !== null ? el : null);
      const line = entry.itemId
        ? visible(document.querySelector<HTMLElement>(`[data-line-id="${entry.itemId}"]`))
        : null;
      // Si la línea no se ve (p. ej. esa persona está en la pestaña Menú), el cambio igual se nota
      // en el total del grupo de la barra de resumen.
      const el =
        line ?? visible(document.querySelector<HTMLElement>('[data-testid="group-total"]'));
      const r = el?.getBoundingClientRect();
      record({
        ...entry,
        kind: 'painted',
        rect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : undefined,
        target: line ? 'line' : el ? 'total' : undefined,
      });
    }),
  );
}
