import '@fontsource-variable/archivo/wdth.css';
import { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { IPhone } from './components/IPhone';
import { Comet, TapRipple, TotalCallout } from './components/Overlays';
import { Closing, Header, Hook, Subtitle } from './components/Titles';
import { BG, BODY, FONT, INK, MUTED, SLOTS, float, toStage } from './layout';
import {
  computeSyncs,
  epochAt,
  frameAt,
  frameFor,
  HOOK,
  totalRect,
  type Timeline,
} from './timeline';

// Alias (no interface): Remotion exige que las props sean un Record<string, unknown>.
export type DemoProps = {
  timeline: Timeline | null;
};

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Espera a que la tipografía esté cargada antes de renderizar frames. */
function useFont() {
  const [handle] = useState(() => delayRender('Cargando Archivo'));
  useEffect(() => {
    Promise.all([
      document.fonts.load('780 56px "Archivo Variable"'),
      document.fonts.load('850 132px "Archivo Variable"'),
    ]).then(() => continueRender(handle));
  }, [handle]);
}

function alpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function Demo({ timeline: tl }: DemoProps) {
  useFont();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!tl) return <AbsoluteFill style={{ background: BG }} />;

  const epoch = epochAt(tl, frame);
  const actionEndFrame = frameAt(tl, tl.actionEnd);
  const syncs = computeSyncs(tl);
  const subtitles = tl.marks.filter((m) => m.kind === 'subtitle');
  const current = [...subtitles].reverse().find((m) => frame >= frameAt(tl, m.t));

  // Momento clave: zoom al celular de Ana (donde se ven las dos líneas y el total), costados atenuados.
  const zoomIn = tl.marks.find((m) => m.kind === 'zoom-in');
  const zoomOut = tl.marks.find((m) => m.kind === 'zoom-out');
  const zA = zoomIn ? frameAt(tl, zoomIn.t) : -1;
  const zB = zoomOut ? frameAt(tl, zoomOut.t) : -1;
  const zoomT =
    zA < 0
      ? 0
      : interpolate(frame, [zA, zA + 18, zB, zB + 18], [0, 1, 1, 0], {
          ...clamp,
          easing: Easing.inOut(Easing.cubic),
        });
  const zoom = 1 + zoomT * 0.32;
  const focus = toStage(0, { x: 201, y: 600 }, frame);

  // Los cambios simultáneos (dos toques a la vez) son el momento clave: latencia del último en verlo.
  const keySyncs = zA < 0 ? [] : syncs.filter((s) => Math.abs(frameAt(tl, s.tapT) - zA) < 15);
  const keyLatency = keySyncs.length
    ? Math.max(...keySyncs.flatMap((s) => s.remotes.map((r) => r.latencyMs)))
    : 0;
  const keyArrive = keySyncs.length
    ? Math.max(...keySyncs.flatMap((s) => s.remotes.map((r) => frameAt(tl, r.t)))) + 10
    : 0;
  const total = totalRect(tl);

  // Cierre: los celulares se alejan antes de la placa final.
  const closing = interpolate(frame, [actionEndFrame - 6, actionEndFrame + 10], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{ background: BG, fontFamily: FONT, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          transform: `scale(${zoom * (1 - closing * 0.12)}) translateY(${closing * 60}px)`,
          transformOrigin: `${focus.x}px ${focus.y}px`,
          opacity: 1 - closing,
        }}
      >
        <Header at={HOOK - 12} />

        {tl.phones.map((phone, i) => {
          const slot = SLOTS[i]!;
          // Entrada: suben desde abajo con un giro 3D, escalonados (primero Ana, después los costados).
          const enter = spring({
            // Entran recién cuando el gancho ya salió, para que no se encimen.
            frame: frame - (HOOK - 14) - (i === 0 ? 0 : 5),
            fps,
            config: { damping: 15, stiffness: 90, mass: 0.9 },
          });
          // Pulso al tocar la pantalla.
          const press = tl.taps
            .filter((t) => t.phone === i && t.t >= tl.actionStart)
            .reduce((acc, t) => {
              const f = frame - frameAt(tl, t.t);
              return f >= 0 && f <= 8 ? Math.max(acc, Math.sin((Math.PI * f) / 8)) : acc;
            }, 0);
          // Aro de color cuando llega un cambio de otra persona.
          let glow: string | undefined;
          for (const s of syncs) {
            for (const r of s.remotes) {
              if (r.phone !== i) continue;
              const end = Math.max(frameAt(tl, r.t), frameAt(tl, s.tapT) + 9);
              const g = interpolate(frame - end, [0, 3, 22], [0, 0.85, 0], clamp);
              if (g > 0) glow = alpha(tl.phones[s.from]!.color, g);
            }
          }
          const dim = i === 0 ? 1 : 1 - zoomT * 0.6;
          const width = BODY.width * slot.scale;
          return (
            <div
              key={phone.name}
              style={{
                position: 'absolute',
                left: slot.cx - width / 2,
                top: slot.top + float(i, frame),
                width,
                opacity: enter * dim,
                transform: `perspective(1400px) translateY(${(1 - enter) * 320}px) rotateX(${(1 - enter) * 28}deg) scale(${1 - press * 0.014})`,
                transformOrigin: 'center bottom',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: -46,
                  left: 0,
                  right: 0,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 9,
                  fontSize: 25,
                  fontWeight: 720,
                  color: INK,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ width: 13, height: 13, borderRadius: 7, background: phone.color }} />
                {phone.name}
                <span style={{ fontWeight: 450, color: MUTED }}>· {phone.role}</span>
              </div>
              <div style={{ transform: `scale(${slot.scale})`, transformOrigin: '0 0' }}>
                <IPhone glow={glow}>
                  <Img
                    src={staticFile(frameFor(phone, epoch).file)}
                    style={{
                      width: tl.viewport.width,
                      height: tl.viewport.height,
                      display: 'block',
                    }}
                  />
                </IPhone>
              </div>
            </div>
          );
        })}

        {tl.taps
          .filter((t) => t.t >= tl.actionStart && t.t <= tl.actionEnd)
          .map((t, k) => {
            const p = toStage(t.phone, t, frame);
            return <TapRipple key={k} x={p.x} y={p.y} at={frameAt(tl, t.t)} />;
          })}

        {syncs.flatMap((s, k) =>
          s.remotes.map((r, j) => (
            <Comet
              key={`${k}-${j}`}
              from={toStage(s.from, s.tap, frame)}
              to={toStage(r.phone, r.point, frame)}
              start={frameAt(tl, s.tapT)}
              arrive={frameAt(tl, r.t)}
              color={tl.phones[s.from]!.color}
            />
          )),
        )}

        {total && keySyncs.length > 0 && (
          <TotalCallout
            rect={(() => {
              const a = toStage(0, total, frame);
              const b = toStage(0, { x: total.x + total.width, y: total.y + total.height }, frame);
              return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
            })()}
            // Etiqueta centrada sobre el celular de Ana, arriba del total (con zoom no entra al costado).
            labelX={toStage(0, { x: tl.viewport.width / 2, y: 0 }, frame).x}
            at={keyArrive}
            until={zB}
            latencyMs={keyLatency}
          />
        )}
      </AbsoluteFill>

      {current?.text && frame < actionEndFrame && (
        <Subtitle key={current.t} text={current.text} from={frameAt(tl, current.t)} />
      )}

      <Hook exitAt={HOOK - 24} />
      <Sequence from={actionEndFrame}>
        <Closing />
      </Sequence>
    </AbsoluteFill>
  );
}
