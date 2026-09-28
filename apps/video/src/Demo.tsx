import '@fontsource-variable/archivo/wdth.css';
import { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Easing,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import { SyncLine, Subtitle, TapRipple } from './components/Overlays';
import {
  ACCENT,
  BEZEL,
  BG,
  FONT,
  H,
  PHONE_H,
  PHONE_W,
  PHONES_Y,
  SCALE,
  SCREEN_H,
  SCREEN_W,
  screenOrigin,
  toStage,
  W,
} from './layout';
import { CLOSE_S, computeSyncs, FPS, frameAt, HOOK_S, type Timeline } from './timeline';

// Alias (no interface): Remotion exige que las props sean un Record<string, unknown>.
export type DemoProps = {
  timeline: Timeline | null;
};

const HOOK = Math.round(HOOK_S * FPS);
const ENTER = HOOK - 14; // los celulares entran un poco antes de que termine el gancho

/** Espera a que la tipografía esté cargada antes de renderizar frames. */
function useFont() {
  const [handle] = useState(() => delayRender('Cargando Archivo'));
  useEffect(() => {
    Promise.all([
      document.fonts.load('750 54px "Archivo Variable"'),
      document.fonts.load('800 96px "Archivo Variable"'),
    ]).then(() => continueRender(handle));
  }, [handle]);
}

export function Demo({ timeline: tl }: DemoProps) {
  useFont();
  const frame = useCurrentFrame();
  if (!tl) return <AbsoluteFill style={{ background: BG }} />;

  const actionEndFrame = frameAt(tl, tl.actionEnd);
  const syncs = computeSyncs(tl);
  const subtitles = tl.marks.filter((m) => m.kind === 'subtitle');
  const current = [...subtitles].reverse().find((m) => frame >= frameAt(tl, m.t));

  // Zoom al momento clave: el celular de Ana, donde aparecen las dos líneas y el total.
  const zoomIn = tl.marks.find((m) => m.kind === 'zoom-in');
  const zoomOut = tl.marks.find((m) => m.kind === 'zoom-out');
  const ZOOM = 1.42;
  let zoom = 1;
  if (zoomIn && zoomOut) {
    const a = frameAt(tl, zoomIn.t);
    const b = frameAt(tl, zoomOut.t);
    zoom = interpolate(frame, [a, a + 16, b, b + 16], [1, ZOOM, ZOOM, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.cubic),
    });
  }
  // Origen del zoom en el borde izquierdo del celular de Ana: así queda entero en cuadro.
  const focus = { x: screenOrigin(0).x - BEZEL, y: toStage(0, { x: 0, y: 600 }).y };

  const enter = interpolate(frame, [ENTER, ENTER + 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{ background: BG, fontFamily: FONT, overflow: 'hidden' }}>
      {/* Escenario: celulares + overlays, con el zoom del momento clave. */}
      <AbsoluteFill
        style={{
          opacity: enter,
          transform: `translateY(${(1 - enter) * 80}px) scale(${zoom})`,
          transformOrigin: `${focus.x}px ${focus.y}px`,
        }}
      >
        <Header />
        {tl.phones.map((phone, i) => {
          const o = screenOrigin(i);
          const offset = Math.round(((tl.actionStart - phone.videoStart) / 1000) * FPS);
          return (
            <div key={phone.name}>
              <div
                style={{
                  position: 'absolute',
                  left: o.x - BEZEL,
                  top: PHONES_Y - 48,
                  width: PHONE_W,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  color: 'white',
                  fontSize: 26,
                  fontWeight: 700,
                }}
              >
                <span style={{ width: 14, height: 14, borderRadius: 7, background: phone.color }} />
                {phone.name}
                <span style={{ fontWeight: 400, color: '#9a9a9a' }}>· {phone.role}</span>
              </div>
              <div
                style={{
                  position: 'absolute',
                  left: o.x - BEZEL,
                  top: o.y - BEZEL,
                  width: PHONE_W,
                  height: PHONE_H,
                  borderRadius: 38,
                  background: '#1c1c1e',
                  border: '1.5px solid #3a3a3c',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: o.x,
                  top: o.y,
                  width: SCREEN_W,
                  height: SCREEN_H,
                  borderRadius: 29,
                  overflow: 'hidden',
                  background: 'white',
                }}
              >
                <Sequence from={ENTER}>
                  <OffthreadVideo
                    src={staticFile(phone.file)}
                    startFrom={Math.max(0, offset - (HOOK - ENTER))}
                    muted
                    style={{
                      width: 390,
                      height: 844,
                      transform: `scale(${SCALE})`,
                      transformOrigin: '0 0',
                    }}
                  />
                </Sequence>
              </div>
            </div>
          );
        })}

        {tl.taps
          .filter((t) => t.t >= tl.actionStart && t.t <= tl.actionEnd)
          .map((t, i) => {
            const p = toStage(t.phone, t);
            return <TapRipple key={i} x={p.x} y={p.y} frame={frameAt(tl, t.t)} />;
          })}

        {syncs.flatMap((s, i) => {
          // Cambios casi simultáneos (dos toques a la vez) comparten una sola etiqueta: la del
          // grupo, con la latencia del último celular en verlo.
          const group = syncs.filter((o) => Math.abs(o.tapT - s.tapT) < 500);
          const leader = group[0] === s;
          const slowest = Math.max(...group.flatMap((g) => g.remotes.map((r) => r.latencyMs)));
          return s.remotes.map((r, j) => (
            <SyncLine
              key={`${i}-${j}`}
              from={toStage(s.from, s.tap)}
              to={toStage(r.phone, r.point)}
              startFrame={frameAt(tl, s.tapT)}
              arriveFrame={frameAt(tl, r.t)}
              latencyMs={slowest}
              // Una etiqueta por cambio (la del destino más lejano), con la latencia del último en verlo.
              showLabel={
                leader &&
                j ===
                  farthest(
                    s.from,
                    s.remotes.map((x) => x.phone),
                  )
              }
              color={tl.phones[s.from]!.color}
            />
          ));
        })}
      </AbsoluteFill>

      {current?.text && frame < actionEndFrame && (
        <Subtitle key={current.t} text={current.text} from={frameAt(tl, current.t)} />
      )}

      <Hook />
      <Sequence from={actionEndFrame}>
        <Closing />
      </Sequence>
    </AbsoluteFill>
  );
}

function farthest(from: number, phones: number[]) {
  let best = 0;
  phones.forEach((p, j) => {
    if (Math.abs(p - from) > Math.abs(phones[best]! - from)) best = j;
  });
  return best;
}

function Header() {
  return (
    <div
      style={{
        position: 'absolute',
        top: 92,
        left: 0,
        right: 0,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          color: ACCENT,
          fontSize: 50,
          fontWeight: 800,
          fontStretch: '68%',
          letterSpacing: '-0.01em',
          lineHeight: 1,
        }}
      >
        HAMBURGUESERÍA TEST
      </div>
      <div style={{ marginTop: 12, color: '#9a9a9a', fontSize: 28 }}>
        Pedido grupal en tiempo real
      </div>
    </div>
  );
}

/** Primeros 2 segundos: el gancho. */
function Hook() {
  const frame = useCurrentFrame();
  if (frame > HOOK + 4) return null;
  const lines = ['3 personas.', '1 pedido.', 'En tiempo real.'];
  const out = interpolate(frame, [HOOK - 12, HOOK + 2], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill
      style={{
        background: BG,
        opacity: out,
        justifyContent: 'center',
        padding: '0 90px',
        gap: 6,
      }}
    >
      {lines.map((line, i) => {
        const start = 2 + i * 12;
        const p = interpolate(frame, [start, start + 10], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.out(Easing.cubic),
        });
        return (
          <div
            key={line}
            style={{
              color: i === 2 ? ACCENT : 'white',
              fontSize: 118,
              fontWeight: 800,
              fontStretch: '72%',
              lineHeight: 1.02,
              letterSpacing: '-0.02em',
              opacity: p,
              transform: `translateY(${(1 - p) * 40}px)`,
            }}
          >
            {line}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

/** Cierre de 2 segundos: stack y llamado al link. */
function Closing() {
  const frame = useCurrentFrame();
  const bg = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  const text = interpolate(frame, [6, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return (
    <AbsoluteFill
      style={{
        background: `rgba(15,15,16,${bg})`,
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        gap: 36,
      }}
    >
      <div
        style={{
          opacity: text,
          transform: `translateY(${(1 - text) * 24}px)`,
          color: 'white',
          fontSize: 58,
          fontWeight: 750,
          letterSpacing: '-0.01em',
        }}
      >
        Node · Socket.IO · Postgres · Redis
      </div>
      <div
        style={{
          opacity: text,
          color: 'white',
          background: ACCENT,
          fontSize: 44,
          fontWeight: 750,
          padding: '14px 28px',
          borderRadius: 12,
        }}
      >
        Demo + código en el link
      </div>
    </AbsoluteFill>
  );
}

export const durationSeconds = (tl: Timeline) =>
  HOOK_S + (tl.actionEnd - tl.actionStart) / 1000 + CLOSE_S;
export { H, W };
