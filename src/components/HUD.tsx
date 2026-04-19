import type { GameStatus, RunStats } from '../game/loop';
import type { LevelConfig } from '../game/levels';

interface Props {
  status: GameStatus;
  level: LevelConfig;
  wireframe: boolean;
  showAdvancedOptions: boolean;
  onToggleWireframe: () => void;
  onRetry: () => void;
  onNextLevel: () => void;   // advance to next level (or return to menu if last)
  onExit: () => void;        // back to menu
  hasNextLevel: boolean;
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
  top: '4rem',
  left: 0,
  right: 0,
  textAlign: 'center',
  fontSize: 'clamp(1rem, 2.5vw, 1.4rem)',
  pointerEvents: 'none',
  color: '#fff',
  textShadow: '0 1px 6px rgba(0,0,0,0.8)',
};

const progressWrap: React.CSSProperties = {
  position: 'fixed',
  top: '1.2rem',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(40vw, 400px)',
  pointerEvents: 'none',
  color: '#fff',
  textShadow: '0 1px 4px rgba(0,0,0,0.8)',
};

const progressLabel: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 'clamp(0.7rem, 1.6vw, 0.9rem)',
  opacity: 0.85,
  marginBottom: '0.25rem',
};

const progressTrack: React.CSSProperties = {
  width: '100%',
  height: '8px',
  background: 'rgba(255,255,255,0.18)',
  border: '1px solid rgba(255,255,255,0.35)',
  borderRadius: '4px',
  overflow: 'hidden',
  boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
};

const progressFill = (pct: number): React.CSSProperties => ({
  width: `${Math.round(pct * 100)}%`,
  height: '100%',
  background: 'linear-gradient(90deg, #00ccff, #ddf5ff)',
  transition: 'width 120ms linear',
});

const topRightButton: React.CSSProperties = {
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

const topRightStack: React.CSSProperties = {
  position: 'fixed',
  top: '1.5rem',
  right: '1.5rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  alignItems: 'flex-end',
};

const statsBox: React.CSSProperties = {
  marginTop: '1.5rem',
  padding: '1rem 1.5rem',
  background: 'rgba(0, 0, 0, 0.35)',
  border: '1px solid rgba(255, 255, 255, 0.25)',
  borderRadius: '0.5rem',
  fontSize: 'clamp(0.95rem, 2vw, 1.1rem)',
  lineHeight: 1.7,
  minWidth: 'min(320px, 80vw)',
};

const missedWarning: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  right: '1.5rem',
  transform: 'translateY(-50%)',
  padding: '0.6rem 0.9rem',
  background: 'rgba(120, 20, 20, 0.6)',
  border: '1px solid rgba(255, 140, 140, 0.7)',
  borderRadius: '0.4rem',
  color: '#ffd6d6',
  fontSize: 'clamp(0.85rem, 1.8vw, 1rem)',
  fontWeight: 600,
  letterSpacing: '0.03em',
  textShadow: '0 1px 4px rgba(0,0,0,0.8)',
  backdropFilter: 'blur(4px)',
  pointerEvents: 'none',
  animation: 'bws-pulse 1.1s ease-in-out infinite',
};

const PULSE_KEYFRAMES = `@keyframes bws-pulse {
  0%, 100% { opacity: 0.7; transform: translateY(-50%) scale(1); }
  50%      { opacity: 1;   transform: translateY(-50%) scale(1.06); }
}`;

// 1 game unit ≈ 0.3 m  (wave height 50 u ≈ 15 m real-world big wave)
const UNITS_TO_MS = 0.3;

function StatsPanel({
  stats, rideTime, starsCollected, starsTotal, starsRequired,
}: {
  stats: RunStats;
  rideTime: number;
  starsCollected: number;
  starsTotal: number;
  starsRequired: number;
}) {
  return (
    <div style={statsBox}>
      <div>Time: <strong>{rideTime.toFixed(2)} s</strong></div>
      <div>Top speed: <strong>{(stats.maxSpeed * UNITS_TO_MS).toFixed(1)} m/s</strong></div>
      <div>Avg speed: <strong>{(stats.avgSpeed * UNITS_TO_MS).toFixed(1)} m/s</strong></div>
      <div>Turns: <strong>{stats.turns}</strong></div>
      {starsTotal > 0 && (
        <div>
          Stars: <strong>{starsCollected}/{starsTotal}</strong>
          {starsRequired < starsTotal && (
            <span style={{ opacity: 0.7 }}> (need {starsRequired})</span>
          )}
        </div>
      )}
    </div>
  );
}

function StarCounter({
  collected, total, required,
}: { collected: number; total: number; required: number }) {
  if (total <= 0) return null;
  const enough = collected >= required;
  return (
    <span style={{ color: enough ? '#ffe14a' : '#fff', fontWeight: 600 }}>
      ★ {collected}/{total}
      {/* {required < total && (
        <span style={{ opacity: 0.75, fontWeight: 400 }}> (need {required})</span>
      )} */}
    </span>
  );
}

export default function HUD({
  status, level, wireframe, showAdvancedOptions,
  onToggleWireframe,
  onRetry, onNextLevel, onExit, hasNextLevel,
}: Props) {
  const {
    phase, stance, rideTime, speed, progress, stats,
    starsCollected, starsTotal, starsRequired, starsMissed,
  } = status;
  const speedMs = (speed * UNITS_TO_MS).toFixed(1);
  const needMoreStars = starsTotal > 0 && starsCollected < starsRequired;

  if (phase === 'surfing') {
    return (
      <>
        <style>{PULSE_KEYFRAMES}</style>
        {starsMissed > 0 && (
          <div style={missedWarning}>
            ★ {starsMissed} missed
          </div>
        )}
        <div style={progressWrap}>
          <div style={progressLabel}>
            <span>{level.name}</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div style={progressTrack}>
            <div style={progressFill(progress)} />
          </div>
        </div>
        <div style={scoreHud}>
          {rideTime.toFixed(1)} s &nbsp;·&nbsp; {speedMs} m/s
          {starsTotal > 0 && (
            <>
              &nbsp;·&nbsp;
              <StarCounter
                collected={starsCollected}
                total={starsTotal}
                required={starsRequired}
              />
            </>
          )}
        </div>
        {needMoreStars && progress >= 0.98 && (
          <div
            style={{
              position: 'fixed',
              top: '7rem',
              left: 0,
              right: 0,
              textAlign: 'center',
              fontSize: 'clamp(0.9rem, 2vw, 1.1rem)',
              color: '#ffdf6a',
              textShadow: '0 1px 6px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
            }}
          >
            Need {starsRequired - starsCollected} more ★ to complete the wave
          </div>
        )}
        <div style={topRightStack}>
          {showAdvancedOptions && (
            <button type="button" style={topRightButton} onClick={onToggleWireframe}>
              Wireframe: {wireframe ? 'ON' : 'OFF'}
            </button>
          )}
          <button type="button" style={topRightButton} onClick={onExit}>
            Menu
          </button>
        </div>
        <div style={hint}>
          {stance === 'prone'
            ? (showAdvancedOptions
                ? '↑ Paddle  ↓ Brake  ← → Steer  ␣ Stand up  C Camera  R Retry'
                : '↑ Paddle  ↓ Brake  ← → Steer')
            : (showAdvancedOptions
                ? '↓ Brake  ← → Carve  ␣ Go prone  C Camera  R Retry'
                : '↓ Brake  ← → Carve')}
        </div>
      </>
    );
  }

  // End-state overlays
  let title = '';
  let accent: React.CSSProperties = {};
  let primaryLabel = 'Retry';
  let primaryAction = onRetry;

  if (phase === 'wiped_out') {
    title = 'WIPEOUT!';
    accent = { color: '#ffdada' };
  } else if (phase === 'missed_wave') {
    title = 'MISSED THE WAVE';
    accent = { color: '#fff2b3' };
  } else if (phase === 'completed') {
    title = 'WAVE COMPLETED';
    accent = { color: '#bfffce' };
    primaryLabel = hasNextLevel ? 'Next level' : 'Back to menu';
    primaryAction = hasNextLevel ? onNextLevel : onExit;
  }

  const enterHint =
    phase === 'completed'
      ? (hasNextLevel ? 'Enter: next level · R: retry · Esc/M: menu' : 'Enter / Esc: menu · R: retry')
      : 'Enter / R: retry · Esc / M: menu';

  return (
    <div style={overlay}>
      <div style={{ ...big, ...accent }}>{title}</div>
      <div style={sub}>{level.name}</div>
      <StatsPanel
        stats={stats}
        rideTime={rideTime}
        starsCollected={starsCollected}
        starsTotal={starsTotal}
        starsRequired={starsRequired}
      />
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', pointerEvents: 'auto' }}>
        <button type="button" style={topRightButton} onClick={primaryAction}>
          {primaryLabel}
        </button>
        {phase === 'completed' && hasNextLevel && (
          <button type="button" style={topRightButton} onClick={onRetry}>
            Retry
          </button>
        )}
        <button type="button" style={topRightButton} onClick={onExit}>
          Menu
        </button>
      </div>
      <div style={{ ...sub, marginTop: '1rem', opacity: 0.6 }}>
        {enterHint}
      </div>
    </div>
  );
}
