// Geometría del video 4:5: tres celulares lado a lado con un marco simple.

export const W = 1080;
export const H = 1350;
export const ACCENT = '#D93A26';
export const BG = '#0f0f10';
export const FONT = "'Archivo Variable', system-ui, sans-serif";

export const SCALE = 0.8; // pantalla de 390×844 → 312×675
export const BEZEL = 10;
export const SCREEN_W = 390 * SCALE;
export const SCREEN_H = 844 * SCALE;
export const PHONE_W = SCREEN_W + BEZEL * 2;
export const PHONE_H = SCREEN_H + BEZEL * 2;
export const GAP = 18;
export const PHONES_X = (W - (PHONE_W * 3 + GAP * 2)) / 2;
export const PHONES_Y = 300;

/** Esquina superior izquierda de la pantalla del celular i, en coordenadas del video. */
export function screenOrigin(i: number) {
  return { x: PHONES_X + i * (PHONE_W + GAP) + BEZEL, y: PHONES_Y + BEZEL };
}

/** Punto de la pantalla del celular (en px CSS de 390×844) llevado al video. */
export function toStage(i: number, p: { x: number; y: number }) {
  const o = screenOrigin(i);
  return { x: o.x + p.x * SCALE, y: o.y + p.y * SCALE };
}
