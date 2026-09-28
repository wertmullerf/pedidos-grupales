import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { ACCENT, FONT, INK } from '../layout';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Toque: punto de "dedo" que se apoya y un círculo que se expande. */
export function TapRipple({ x, y, at }: { x: number; y: number; at: number }) {
  const f = useCurrentFrame() - at;
  if (f < -3 || f > 24) return null;
  const ring = interpolate(f, [0, 22], [0.35, 2.1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const ringOpacity = interpolate(f, [0, 22], [0.85, 0], clamp);
  const press = interpolate(f, [-3, 0, 6, 16], [0, 1, 1, 0], clamp);
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: x - 26,
          top: y - 26,
          width: 52,
          height: 52,
          borderRadius: '50%',
          border: `4px solid ${INK}`,
          transform: `scale(${ring})`,
          opacity: ringOpacity * 0.55,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: x - 17,
          top: y - 17,
          width: 34,
          height: 34,
          borderRadius: '50%',
          background: 'rgba(20,20,20,.28)',
          border: '2px solid rgba(255,255,255,.9)',
          transform: `scale(${0.7 + press * 0.3})`,
          opacity: press,
        }}
      />
    </>
  );
}

/**
 * El cambio viaja del celular que tocó al que lo recibe: un cometa con estela del color de la
 * persona y un estallido al llegar, en el frame en que realmente se pintó en esa pantalla.
 */
export function Comet({
  from,
  to,
  start,
  arrive,
  color,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  start: number;
  arrive: number;
  color: string;
}) {
  const frame = useCurrentFrame();
  // La latencia real (30–70 ms) es 1–2 frames: el viaje se dibuja en ~9 frames para que se vea,
  // y el estallido cae en el frame real en que se pintó el cambio (o apenas después).
  const end = Math.max(arrive, start + 9);
  if (frame < start || frame > end + 26) return null;

  const cx = (from.x + to.x) / 2;
  const cy = Math.min(from.y, to.y) - 170;
  const pt = (t: number) => ({
    x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * cx + t ** 2 * to.x,
    y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * cy + t ** 2 * to.y,
  });
  const p = interpolate(frame, [start, end], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.quad),
  });
  const trail = Array.from({ length: 14 }, (_, k) => Math.max(0, p - k * 0.035));
  const burst = frame - end;

  return (
    <>
      {p < 1 &&
        trail.map((t, k) => {
          const q = pt(t);
          const size = 20 - k * 1.1;
          return (
            <div
              key={k}
              style={{
                position: 'absolute',
                left: q.x - size / 2,
                top: q.y - size / 2,
                width: size,
                height: size,
                borderRadius: '50%',
                background: color,
                opacity: (1 - k / 14) * 0.9,
              }}
            />
          );
        })}
      {burst >= 0 && (
        <>
          <div
            style={{
              position: 'absolute',
              left: to.x - 34,
              top: to.y - 34,
              width: 68,
              height: 68,
              borderRadius: '50%',
              border: `5px solid ${color}`,
              transform: `scale(${interpolate(burst, [0, 18], [0.3, 1.9], clamp)})`,
              opacity: interpolate(burst, [0, 18], [1, 0], clamp),
            }}
          />
          {Array.from({ length: 8 }, (_, k) => {
            const a = (k / 8) * Math.PI * 2;
            const d = interpolate(burst, [0, 16], [8, 56], {
              ...clamp,
              easing: Easing.out(Easing.cubic),
            });
            return (
              <div
                key={k}
                style={{
                  position: 'absolute',
                  left: to.x + Math.cos(a) * d - 4,
                  top: to.y + Math.sin(a) * d - 4,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: color,
                  opacity: interpolate(burst, [0, 16], [1, 0], clamp),
                }}
              />
            );
          })}
        </>
      )}
    </>
  );
}

/**
 * Recuadro animado alrededor del total del celular de Ana y, arriba (centrada en `labelX`), la
 * etiqueta "Total exacto" con la latencia real del momento clave, unidas por una línea vertical.
 */
export function TotalCallout({
  rect,
  labelX,
  at,
  until,
  latencyMs,
}: {
  rect: { x: number; y: number; width: number; height: number };
  labelX: number;
  at: number;
  until: number;
  latencyMs: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at || frame > until + 12) return null;
  const pop = spring({ frame: frame - at, fps, config: { damping: 13, stiffness: 160 } });
  const line = interpolate(frame - at, [4, 14], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const label = spring({ frame: frame - at - 8, fps, config: { damping: 12, stiffness: 170 } });
  const out = interpolate(frame, [until, until + 12], [1, 0], clamp);
  const pad = 8;
  const boxTop = rect.y - pad;
  const labelBottom = boxTop - 16;
  const boxCx = rect.x + rect.width / 2;
  return (
    <div style={{ opacity: out }}>
      <div
        style={{
          position: 'absolute',
          left: rect.x - pad,
          top: rect.y - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          borderRadius: 10,
          border: `4px solid ${ACCENT}`,
          transform: `scale(${0.8 + pop * 0.2})`,
          opacity: pop,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: boxCx - 2,
          top: boxTop - (boxTop - labelBottom) * line,
          width: 4,
          height: (boxTop - labelBottom) * line,
          background: ACCENT,
          borderRadius: 2,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: labelX,
          top: labelBottom,
          transform: `translate(-50%, -100%) scale(${label})`,
          transformOrigin: 'center bottom',
          // Una sola pastilla, compacta, en la franja libre arriba del total: no tapa las líneas.
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: ACCENT,
          color: 'white',
          padding: '7px 14px',
          borderRadius: 10,
          whiteSpace: 'nowrap',
          fontFamily: FONT,
          fontSize: 22,
          fontWeight: 650,
        }}
      >
        <span style={{ fontWeight: 800, fontSize: 24 }}>✓ Total exacto</span>
        <span style={{ opacity: 0.9 }}>· sincronizado en {latencyMs} ms</span>
      </div>
    </div>
  );
}
