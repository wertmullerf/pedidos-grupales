import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { ACCENT, BG, FONT, INK, MUTED } from '../layout';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Gancho de los primeros 2 segundos: tipografía cinética sobre blanco. */
export function Hook({ exitAt }: { exitAt: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame > exitAt + 14) return null;
  const lines = ['3 personas.', '1 pedido.', 'En tiempo real.'];
  const exit = interpolate(frame, [exitAt, exitAt + 12], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.cubic),
  });
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        padding: '0 96px',
        fontFamily: FONT,
        opacity: 1 - exit,
        transform: `translateY(${-exit * 120}px) scale(${1 - exit * 0.08})`,
      }}
    >
      {lines.map((line, i) => {
        const s = spring({
          frame: frame - 3 - i * 11,
          fps,
          config: { damping: 14, stiffness: 130 },
        });
        const accent = i === 2;
        const underline = interpolate(frame, [30, 44], [0, 1], {
          ...clamp,
          easing: Easing.out(Easing.cubic),
        });
        return (
          <div
            key={line}
            style={{
              position: 'relative',
              alignSelf: 'flex-start',
              color: accent ? ACCENT : INK,
              fontSize: 132,
              fontWeight: 850,
              fontStretch: '70%',
              lineHeight: 1,
              letterSpacing: '-0.02em',
              opacity: s,
              filter: `blur(${(1 - s) * 10}px)`,
              transform: `translateY(${(1 - s) * 70}px) rotate(${(1 - s) * -4}deg)`,
              transformOrigin: 'left bottom',
            }}
          >
            {line}
            {accent && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  bottom: -14,
                  height: 12,
                  width: `${underline * 100}%`,
                  background: ACCENT,
                  borderRadius: 6,
                }}
              />
            )}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

/** Subtítulo grande, palabra por palabra. Lo que va entre *asteriscos* se resalta con el acento. */
export function Subtitle({ text, from }: { text: string; from: number }) {
  const frame = useCurrentFrame() - from;
  const { fps } = useVideoConfig();
  const words: { word: string; strong: boolean }[] = [];
  let strong = false;
  for (const raw of text.split(' ')) {
    const opens = raw.startsWith('*');
    const closes = raw.endsWith('*') || raw.endsWith('*…');
    const word = raw.replace(/\*/g, '');
    if (opens) strong = true;
    words.push({ word, strong });
    if (closes) strong = false;
  }
  return (
    <div
      style={{
        position: 'absolute',
        left: 70,
        right: 70,
        bottom: 78,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        columnGap: 14,
        rowGap: 2,
        fontFamily: FONT,
        fontWeight: 780,
        fontSize: 56,
        lineHeight: 1.12,
        letterSpacing: '-0.015em',
        color: INK,
      }}
    >
      {words.map(({ word, strong: isStrong }, i) => {
        const s = spring({ frame: frame - i * 2.2, fps, config: { damping: 15, stiffness: 180 } });
        const mark = interpolate(frame, [words.length * 2.2 + 4, words.length * 2.2 + 14], [0, 1], {
          ...clamp,
          easing: Easing.out(Easing.cubic),
        });
        return (
          <span
            key={i}
            style={{
              position: 'relative',
              display: 'inline-block',
              color: isStrong ? ACCENT : INK,
              opacity: s,
              transform: `translateY(${(1 - s) * 26}px)`,
            }}
          >
            {isStrong && (
              <span
                style={{
                  position: 'absolute',
                  left: -4,
                  right: -4,
                  bottom: 6,
                  height: 16,
                  transformOrigin: 'left center',
                  transform: `scaleX(${mark})`,
                  background: 'rgba(217,58,38,.14)',
                  borderRadius: 4,
                  zIndex: -1,
                }}
              />
            )}
            {word}
          </span>
        );
      })}
    </div>
  );
}

/** Encabezado fijo: la marca de la demo. */
export function Header({ at }: { at: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 16 } });
  return (
    <div
      style={{
        position: 'absolute',
        top: 96,
        left: 0,
        right: 0,
        textAlign: 'center',
        fontFamily: FONT,
        opacity: s,
        transform: `translateY(${(1 - s) * -20}px)`,
      }}
    >
      <div
        style={{
          color: ACCENT,
          fontSize: 54,
          fontWeight: 850,
          fontStretch: '68%',
          lineHeight: 1,
          letterSpacing: '-0.01em',
        }}
      >
        HAMBURGUESERÍA TEST
      </div>
      <div style={{ marginTop: 12, color: MUTED, fontSize: 28, fontWeight: 500 }}>
        Pedido grupal en tiempo real
      </div>
    </div>
  );
}

/** Cierre: el stack, en pastillas que entran escalonadas. */
export function Closing() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bg = interpolate(frame, [0, 10], [0, 1], clamp);
  const title = spring({ frame: frame - 4, fps, config: { damping: 15 } });
  const stack = ['Node', 'Socket.IO', 'Postgres', 'Redis'];
  return (
    <AbsoluteFill
      style={{
        background: `rgba(255,255,255,${bg})`,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 44,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          color: INK,
          fontSize: 76,
          fontWeight: 850,
          fontStretch: '72%',
          letterSpacing: '-0.02em',
          textAlign: 'center',
          lineHeight: 1.02,
          opacity: title,
          transform: `translateY(${(1 - title) * 30}px)`,
        }}
      >
        Pedido grupal
        <br />
        <span style={{ color: ACCENT }}>en tiempo real</span>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
        {stack.map((name, i) => {
          const s = spring({
            frame: frame - 12 - i * 4,
            fps,
            config: { damping: 11, stiffness: 170 },
          });
          return (
            <span
              key={name}
              style={{
                border: `2.5px solid ${INK}`,
                color: INK,
                fontSize: 36,
                fontWeight: 700,
                padding: '10px 22px',
                borderRadius: 12,
                opacity: s,
                transform: `translateY(${(1 - s) * 30}px) scale(${0.8 + s * 0.2})`,
              }}
            >
              {name}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

export { BG };
