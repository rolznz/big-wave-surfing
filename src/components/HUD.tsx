import type { GameStatus } from '../game/loop';

interface Props {
  status: GameStatus;
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

// 1 game unit ≈ 0.3 m  (wave height 50 u ≈ 15 m real-world big wave)
const UNITS_TO_MS = 0.3;

export default function HUD({ status }: Props) {
  const { phase, rideTime, speed } = status;
  const speedMs = (speed * UNITS_TO_MS).toFixed(1);

  if (phase === 'surfing') {
    return (
      <>
        <div style={scoreHud}>
          {rideTime.toFixed(1)} s &nbsp;·&nbsp; {speedMs} m/s
        </div>
        <div style={hint}>↑ Paddle  ↓ Brake  ← → Steer</div>
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
