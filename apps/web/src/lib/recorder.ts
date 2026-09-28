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
      const el = entry.itemId
        ? document.querySelector<HTMLElement>(`[data-line-id="${entry.itemId}"]`)
        : null;
      const r = el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
      record({
        ...entry,
        kind: 'painted',
        rect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : undefined,
      });
    }),
  );
}
