import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { ACCENT, FONT } from '../layout';

/** Toque: punto de "dedo" que se apoya y un círculo que se expande. */
export function TapRipple({ x, y, frame: at }: { x: number; y: number; frame: number }) {
  const f = useCurrentFrame() - at;
  if (f < 0 || f > 22) return null;
  const ring = interpolate(f, [0, 20], [0.4, 1.9], { easing: Easing.out(Easing.cubic) });
  const ringOpacity = interpolate(f, [0, 20], [0.9, 0], { extrapolateRight: 'clamp' });
  const dotOpacity = interpolate(f, [0, 4, 12, 20], [0, 0.85, 0.85, 0], {
    extrapolateRight: 'clamp',
  });
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
          border: '4px solid white',
          boxShadow: '0 0 0 2px rgba(0,0,0,.35)',
          transform: `scale(${ring})`,
          opacity: ringOpacity,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: x - 15,
          top: y - 15,
          width: 30,
          height: 30,
          borderRadius: '50%',
          background: 'rgba(255,255,255,.9)',
          boxShadow: '0 2px 8px rgba(0,0,0,.4)',
          opacity: dotOpacity,
        }}
      />
    </>
  );
}

/**
 * Línea animada del celular que tocó al que recibió el cambio, destello en el destino y
 * etiqueta con la latencia real medida.
 */
export function SyncLine({
  from,
  to,
  startFrame,
  arriveFrame,
  latencyMs,
  showLabel,
  color,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  startFrame: number;
  arriveFrame: number;
  latencyMs: number;
  showLabel: boolean;
  color: string;
}) {
  const frame = useCurrentFrame();
  // La latencia real (~50 ms) es menos de 2 frames: la línea se dibuja un poco más lento para que
  // se vea, pero el destello y la etiqueta salen en el frame real en que se pintó el cambio.
  const drawEnd = Math.max(arriveFrame, startFrame + 9);
  const f = frame - startFrame;
  if (f < 0 || frame > drawEnd + 40) return null;

  const cx = (from.x + to.x) / 2;
  const cy = Math.min(from.y, to.y) - 150;
  const d = `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
  const length = 1400;
  const progress = interpolate(frame, [startFrame, drawEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.quad),
  });
  const fade = interpolate(frame, [drawEnd + 18, drawEnd + 40], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const flash = frame - drawEnd;

  return (
    <>
      <svg
        style={{ position: 'absolute', inset: 0, overflow: 'visible', opacity: fade }}
        width="100%"
        height="100%"
      >
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - progress)}
          style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.45))' }}
        />
      </svg>
      {flash >= 0 && flash < 20 && (
        <div
          style={{
            position: 'absolute',
            left: to.x - 30,
            top: to.y - 30,
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: color,
            opacity: interpolate(flash, [0, 20], [0.55, 0]),
            transform: `scale(${interpolate(flash, [0, 20], [0.4, 2.2])})`,
          }}
        />
      )}
      {showLabel && flash >= 0 && (
        <div
          style={{
            position: 'absolute',
            left: cx,
            top: cy + 40,
            transform: `translate(-50%, -50%) scale(${interpolate(flash, [0, 6], [0.8, 1], {
              extrapolateRight: 'clamp',
            })})`,
            opacity: fade * interpolate(flash, [0, 5], [0, 1], { extrapolateRight: 'clamp' }),
            background: 'white',
            color: '#111',
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: 26,
            padding: '8px 14px',
            borderRadius: 10,
            whiteSpace: 'nowrap',
            boxShadow: '0 6px 20px rgba(0,0,0,.35)',
          }}
        >
          sincronizado en <span style={{ color: ACCENT }}>{latencyMs} ms</span>
        </div>
      )}
    </>
  );
}

/** Subtítulo grande, legible sin sonido. */
export function Subtitle({ text, from }: { text: string; from: number }) {
  const f = useCurrentFrame() - from;
  const opacity = interpolate(f, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const y = interpolate(f, [0, 8], [16, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: 60,
        right: 60,
        bottom: 70,
        textAlign: 'center',
        color: 'white',
        fontFamily: FONT,
        fontWeight: 750,
        fontSize: 54,
        lineHeight: 1.12,
        textWrap: 'balance',
        letterSpacing: '-0.01em',
        opacity,
        transform: `translateY(${y}px)`,
      }}
    >
      {text}
    </div>
  );
}
