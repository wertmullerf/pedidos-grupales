// Datos que exporta scripts/record-demo.ts y cálculos derivados (toques → eventos → latencias).

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Phone {
  name: string;
  role: string;
  participantId: string | null;
  videoStart: number;
  file: string;
  color: string;
}

export interface Timeline {
  viewport: { width: number; height: number };
  code: string;
  actionStart: number;
  actionEnd: number;
  phones: Phone[];
  marks: { t: number; kind: 'subtitle' | 'zoom-in' | 'zoom-out'; text?: string }[];
  taps: { phone: number; t: number; x: number; y: number }[];
  records: {
    phone: number;
    kind: 'applied' | 'painted';
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
export const HOOK_S = 2.2;
export const CLOSE_S = 2.6;

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
      .map((r) => ({
        phone: r.phone,
        t: r.t,
        latencyMs: Math.round(r.t - tap.t),
        point:
          r.target === 'line'
            ? { x: r.rect!.x + 60, y: r.rect!.y + 22 }
            : { x: r.rect!.x + r.rect!.width / 2, y: r.rect!.y + r.rect!.height / 2 },
      }));
    if (remotes.length)
      syncs.push({ from: tap.phone, tapT: tap.t, tap, version: own.version, remotes });
  }
  return syncs;
}

/** Frame del video final en el que ocurre un instante (epoch ms) de la acción grabada. */
export const frameAt = (tl: Timeline, epoch: number) =>
  Math.round((HOOK_S + (epoch - tl.actionStart) / 1000) * FPS);

export const totalFrames = (tl: Timeline) =>
  Math.round((HOOK_S + (tl.actionEnd - tl.actionStart) / 1000 + CLOSE_S) * FPS);
