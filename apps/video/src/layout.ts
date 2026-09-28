// Geometría del video 4:5: tres iPhone 17, Ana al centro (más grande) y Beto y Cata a los costados.

export const W = 1080;
export const H = 1350;
export const ACCENT = '#D93A26';
export const INK = '#141414';
export const MUTED = '#6f6f6f';
export const BG = '#ffffff';
export const FONT = "'Archivo Variable', system-ui, sans-serif";

/** iPhone 17: pantalla de 402×874 pt; la app ocupa lo que queda debajo de la barra de estado. */
export const SCREEN = { width: 402, height: 874 };
export const STATUS_BAR = 54;
export const BEZEL = 11;
export const BODY = { width: SCREEN.width + BEZEL * 2, height: SCREEN.height + BEZEL * 2 };

export interface Slot {
  /** Centro horizontal del celular en el video. */
  cx: number;
  top: number;
  scale: number;
}

const CENTER_SCALE = 0.79;
const SIDE_SCALE = 0.66;
const GAP = 26;
const CENTER_W = BODY.width * CENTER_SCALE;
const SIDE_W = BODY.width * SIDE_SCALE;
const TOP = 318;

/** Lugar de cada celular: 0 = Ana (centro), 1 = Beto (izquierda), 2 = Cata (derecha). */
export const SLOTS: Slot[] = [
  { cx: W / 2, top: TOP, scale: CENTER_SCALE },
  { cx: W / 2 - CENTER_W / 2 - GAP - SIDE_W / 2, top: TOP + 62, scale: SIDE_SCALE },
  { cx: W / 2 + CENTER_W / 2 + GAP + SIDE_W / 2, top: TOP + 62, scale: SIDE_SCALE },
];

/** Flotación suave de cada celular (px), para que la escena no quede estática. */
export function float(i: number, frame: number) {
  return Math.sin(frame / 38 + i * 2.1) * 4;
}

/** Punto de la app (px CSS del viewport de 402×820) llevado a coordenadas del video. */
export function toStage(i: number, p: { x: number; y: number }, frame: number) {
  const s = SLOTS[i]!;
  const left = s.cx - (BODY.width * s.scale) / 2;
  return {
    x: left + (BEZEL + p.x) * s.scale,
    y: s.top + float(i, frame) + (BEZEL + STATUS_BAR + p.y) * s.scale,
  };
}
