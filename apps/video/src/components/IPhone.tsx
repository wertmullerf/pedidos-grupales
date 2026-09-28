import type { ReactNode } from 'react';
import { BEZEL, BODY, INK, SCREEN, STATUS_BAR } from '../layout';

/**
 * Mockup de iPhone 17 (pantalla de 402×874 pt): marco negro con borde de aluminio, Dynamic
 * Island, barra de estado, indicador de inicio y botones laterales. Se dibuja a tamaño real en pt
 * y se escala desde afuera.
 */
export function IPhone({ children, glow }: { children: ReactNode; glow?: string }) {
  const radius = 64;
  return (
    <div style={{ position: 'relative', width: BODY.width, height: BODY.height }}>
      {/* Botones laterales: acción + volumen a la izquierda, encendido + Camera Control a la derecha. */}
      {[
        { side: 'left', top: 150, h: 36 },
        { side: 'left', top: 215, h: 64 },
        { side: 'left', top: 292, h: 64 },
        { side: 'right', top: 235, h: 96 },
        { side: 'right', top: 560, h: 60 },
      ].map((b, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: b.top,
            [b.side]: -4,
            width: 6,
            height: b.h,
            borderRadius: 3,
            background: '#2b2b2e',
          }}
        />
      ))}

      {/* Cuerpo */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: radius,
          background: '#0c0c0d',
          boxShadow: `inset 0 0 0 2.5px #56565a, inset 0 0 0 5px #111, 0 30px 60px rgba(0,0,0,.16), 0 8px 18px rgba(0,0,0,.10)${
            glow ? `, 0 0 0 6px ${glow}` : ''
          }`,
        }}
      />

      {/* Pantalla */}
      <div
        style={{
          position: 'absolute',
          left: BEZEL,
          top: BEZEL,
          width: SCREEN.width,
          height: SCREEN.height,
          borderRadius: radius - BEZEL,
          overflow: 'hidden',
          background: 'white',
        }}
      >
        <StatusBar />
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: STATUS_BAR,
            width: SCREEN.width,
            height: SCREEN.height - STATUS_BAR,
          }}
        >
          {children}
        </div>
        {/* Dynamic Island */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 11,
            width: 124,
            height: 36,
            marginLeft: -62,
            borderRadius: 20,
            background: '#000',
          }}
        />
        {/* Indicador de inicio */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 8,
            width: 140,
            height: 5,
            marginLeft: -70,
            borderRadius: 3,
            background: INK,
          }}
        />
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: '0 0 auto 0',
        height: STATUS_BAR,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 34px 0 42px',
        color: INK,
        fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
        fontWeight: 600,
        fontSize: 17,
        background: 'white',
      }}
    >
      <span>9:41</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Señal */}
        <svg width="19" height="12" viewBox="0 0 19 12">
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x={i * 5}
              y={9 - i * 3}
              width="3.4"
              height={3 + i * 3}
              rx="1"
              fill={INK}
            />
          ))}
        </svg>
        {/* Wi-Fi */}
        <svg width="17" height="12" viewBox="0 0 17 12">
          <path
            d="M8.5 11.5l2.4-2.9a3.6 3.6 0 0 0-4.8 0zM4 5.9a6.8 6.8 0 0 1 9 0l1.6-1.9a9.4 9.4 0 0 0-12.2 0zM.8 2.2L2.4 4a11.6 11.6 0 0 1 12.2 0l1.6-1.8A14 14 0 0 0 .8 2.2z"
            fill={INK}
          />
        </svg>
        {/* Batería */}
        <svg width="27" height="13" viewBox="0 0 27 13">
          <rect
            x="0.5"
            y="0.5"
            width="23"
            height="12"
            rx="3.5"
            fill="none"
            stroke={INK}
            opacity=".4"
          />
          <rect x="2" y="2" width="20" height="9" rx="2" fill={INK} />
          <rect x="24.8" y="4.2" width="1.8" height="4.6" rx="0.9" fill={INK} opacity=".45" />
        </svg>
      </span>
    </div>
  );
}
