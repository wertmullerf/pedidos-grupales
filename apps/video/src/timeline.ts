// Datos que exporta scripts/record-demo.ts y cálculos derivados (toques → eventos → latencias).

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Frame {
  /** Hora epoch (ms) en que el navegador pintó este cuadro. */
  t: number;
  file: string;
}

export interface Phone {
  name: string;
  role: string;
  participantId: string | null;
  color: string;
  frames: Frame[];
}

export interface Timeline {
  viewport: { width: number; height: number };
  dpr: number;
  code: string;
  actionStart: number;
  actionEnd: number;
  phones: Phone[];
  marks: { t: number; kind: 'subtitle' | 'zoom-in' | 'zoom-out'; text?: string }[];
  taps: { phone: number; t: number; x: number; y: number }[];
  records: {
    phone: number;
    kind: 'applied' | 'painted' | 'settled';
    t: number;
    version: number;
    type: string;
    by: string | null;
    itemId: string | null;
    rect?: Rect;
    target?: 'line' | 'total';
  }[];
}

export const FPS = 30;
export const HOOK_S = 2.6;
export const CLOSE_S = 3.0;

export const HOOK = Math.round(HOOK_S * FPS);

/** Frame del video final en el que ocurre un instante (epoch ms) de la grabación. */
export const frameAt = (tl: Timeline, epoch: number) =>
  Math.round((HOOK_S + (epoch - tl.actionStart) / 1000) * FPS);

/** Instante de la grabación (epoch ms) que corresponde a un frame del video final. */
export const epochAt = (tl: Timeline, frame: number) =>
  tl.actionStart + (frame / FPS - HOOK_S) * 1000;

export const totalFrames = (tl: Timeline) =>
  Math.round((HOOK_S + (tl.actionEnd - tl.actionStart) / 1000 + CLOSE_S) * FPS);

/** Último cuadro pintado hasta ese instante: así las tres pantallas quedan alineadas al ms. */
export function frameFor(phone: Phone, epoch: number): Frame {
  const frames = phone.frames;
  let lo = 0;
  let hi = frames.length - 1;
  if (epoch <= frames[0]!.t) return frames[0]!;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid]!.t <= epoch) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo]!;
}

/** Un cambio hecho en un celular y cómo llegó a los otros, con la latencia medida. */
export interface Sync {
  from: number;
  tapT: number;
  tap: { x: number; y: number };
  version: number;
  remotes: { phone: number; t: number; latencyMs: number; point: { x: number; y: number } }[];
}

/** Para cada toque que produjo un item_added, busca cuándo se pintó en los otros celulares. */
export function computeSyncs(tl: Timeline): Sync[] {
  const syncs: Sync[] = [];
  for (const tap of tl.taps) {
    if (tap.t < tl.actionStart || tap.t > tl.actionEnd) continue;
    const me = tl.phones[tap.phone]?.participantId;
    const own = tl.records
      .filter(
        (r) =>
          r.phone === tap.phone &&
          r.kind === 'applied' &&
          r.by === me &&
          r.t >= tap.t &&
          r.t - tap.t < 1500,
      )
      .sort((a, b) => a.t - b.t)[0];
    if (!own || own.type !== 'item_added') continue;
    const remotes = tl.records
      .filter(
        (r) => r.kind === 'painted' && r.version === own.version && r.phone !== tap.phone && r.rect,
      )
      .map((r) => {
        // Hora: cuando se pintó (latencia real). Posición: la final, cuando terminó la animación.
        const settled = tl.records.find(
          (s) => s.kind === 'settled' && s.phone === r.phone && s.version === r.version,
        );
        const rect = settled?.rect ?? r.rect!;
        return {
          phone: r.phone,
          t: r.t,
          latencyMs: Math.round(r.t - tap.t),
          point:
            r.target === 'line'
              ? { x: rect.x + 70, y: rect.y + rect.height / 2 }
              : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        };
      });
    if (remotes.length) {
      syncs.push({ from: tap.phone, tapT: tap.t, tap, version: own.version, remotes });
    }
  }
  return syncs;
}

/** Rectángulo del total del grupo (barra de resumen), igual en todas las pantallas. */
export function totalRect(tl: Timeline): Rect | null {
  return tl.records.find((r) => r.target === 'total' && r.rect)?.rect ?? null;
}
