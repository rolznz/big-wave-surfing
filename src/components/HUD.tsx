import type { GameStatus } from '../game/loop';

interface Props {
  status: GameStatus;
  onCycleCamera: () => void;
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  color: '#fff',
  textShadow: '0 2px 8px rgba(0,0,0,0.7)',
};

const big: React.CSSProperties = {
  fontSize: 'clamp(2rem, 6vw, 4rem)',
  fontWeight: 700,
  letterSpacing: '0.04em',
};

const sub: React.CSSProperties = {
  fontSize: 'clamp(1rem, 3vw, 1.6rem)',
  marginTop: '0.5rem',
  opacity: 0.9,
};

const hint: React.CSSProperties = {
  position: 'fixed',
  bottom: '2rem',
  left: 0,
  right: 0,
  textAlign: 'center',
  fontSize: 'clamp(0.8rem, 2vw, 1rem)',
  opacity: 0.7,
  pointerEvents: 'none',
  color: '#fff',
  textShadow: '0 1px 4px rgba(0,0,0,0.8)',
};

const scoreHud: React.CSSProperties = {
  position: 'fixed',
  top: '1.5rem',
  left: 0,
  right: 0,
  textAlign: 'center',
  fontSize: 'clamp(1rem, 2.5vw, 1.4rem)',
  pointerEvents: 'none',
  color: '#fff',
  textShadow: '0 1px 6px rgba(0,0,0,0.8)',
};

const cameraButton: React.CSSProperties = {
  position: 'fixed',
  top: '1.5rem',
  right: '1.5rem',
  padding: '0.5rem 0.9rem',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  fontSize: 'clamp(0.8rem, 1.8vw, 1rem)',
  color: '#fff',
  background: 'rgba(0, 0, 0, 0.35)',
  border: '1px solid rgba(255, 255, 255, 0.4)',
  borderRadius: '0.4rem',
  cursor: 'pointer',
  pointerEvents: 'auto',
  textShadow: '0 1px 4px rgba(0,0,0,0.8)',
  backdropFilter: 'blur(4px)',
};

const CAMERA_LABEL = { fixed: 'Fixed', chase: 'Chase' } as const;

// 1 game unit ≈ 0.3 m  (wave height 50 u ≈ 15 m real-world big wave)
const UNITS_TO_MS = 0.3;

export default function HUD({ status, onCycleCamera }: Props) {
  const { phase, stance, cameraMode, rideTime, speed } = status;
  const speedMs = (speed * UNITS_TO_MS).toFixed(1);

  if (phase === 'surfing') {
    return (
      <>
        <div style={scoreHud}>
          {rideTime.toFixed(1)} s &nbsp;·&nbsp; {speedMs} m/s &nbsp;·&nbsp; {stance === 'prone' ? 'PRONE' : 'STANDING'}
        </div>
        <button type="button" style={cameraButton} onClick={onCycleCamera}>
          Camera: {CAMERA_LABEL[cameraMode]}
        </button>
        <div style={hint}>
          {stance === 'prone' ? '↑ Paddle  ↓ Brake  ← → Steer  ␣ Stand up  C Camera' : '↓ Brake  ← → Carve  ␣ Go prone  C Camera'}
        </div>
      </>
    );
  }

  // wiped_out
  return (
    <div style={overlay}>
      <div style={big}>WIPEOUT!</div>
      <div style={sub}>Rode {rideTime.toFixed(1)} seconds</div>
      <div style={{ ...sub, marginTop: '1.5rem', opacity: 0.6 }}>
        Refresh to try again
      </div>
    </div>
  );
}
