import type { GameStatus, RunStats } from '../game/loop';
import { finalScore } from '../game/loop';
import type { LevelConfig } from '../game/levels';
import { NOTIF_MAX_SCALE } from '../game/constants';

export interface NotificationState {
  id: number;
  text: string;
  durationMs: number;
  points: number;
  /** Visual size multiplier (1.0 = base font size). */
  scale: number;
}

interface Props {
  status: GameStatus;
  level: LevelConfig;
  wireframe: boolean;
  showAdvancedOptions: boolean;
  showMenuButton: boolean;
  notifications: NotificationState[];
  editorMode: boolean;
  /** True while the editor is in recording mode and the player is surfing. */
  recording: boolean;
  /** True while the editor is previewing the assembled level. */
  previewing: boolean;
  onToggleWireframe: () => void;
  onRetry: () => void;
  onNextLevel: () => void;   // advance to next level (or return to menu if last)
  onExit: () => void;        // back to menu
  onExitPreview: () => void; // back to editor overlay from preview
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

const notifStack: React.CSSProperties = {
  position: 'fixed',
  bottom: '10%',
  left: 0,
  right: 0,
  display: 'flex',
  // column-reverse pins the newest (last-pushed) notification to the bottom
  // and lets older notifications stack upward.
  flexDirection: 'column-reverse',
  alignItems: 'center',
  gap: '0.35em',
  pointerEvents: 'none',
};

function notifText(scale: number): React.CSSProperties {
  return {
    textAlign: 'center',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    fontSize: `clamp(${(28 * scale).toFixed(1)}px, ${(6 * scale).toFixed(2)}vw, ${(64 * scale).toFixed(1)}px)`,
    fontWeight: 800,
    letterSpacing: '0.05em',
    color: '#fff',
    textShadow: '0 2px 16px rgba(0,0,0,0.55), 0 0 2px rgba(0,0,0,0.9)',
    lineHeight: 1,
  };
}

const notifPoints: React.CSSProperties = {
  marginLeft: '0.5em',
  fontSize: '0.7em',
  fontWeight: 700,
  color: '#ffe14a',
  textShadow: '0 2px 10px rgba(0,0,0,0.6), 0 0 2px rgba(0,0,0,0.9)',
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

const balanceWrap: React.CSSProperties = {
  position: 'fixed',
  top: '1.2rem',
  left: '1.2rem',
  width: 'min(28vw, 160px)',
  pointerEvents: 'none',
  color: '#fff',
  textShadow: '0 1px 4px rgba(0,0,0,0.8)',
};

const balanceLabel: React.CSSProperties = {
  fontSize: 'clamp(0.65rem, 1.4vw, 0.8rem)',
  opacity: 0.85,
  marginBottom: '0.2rem',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
};

const balanceTrack: React.CSSProperties = {
  width: '100%',
  height: '8px',
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(255,255,255,0.35)',
  borderRadius: '4px',
  overflow: 'hidden',
  boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
};

function balanceColor(b: number): string {
  if (b >= 0.6) return '#5fdc6c';
  if (b >= 0.3) return '#ffc24a';
  return '#ff5c5c';
}

const balanceFill = (b: number): React.CSSProperties => ({
  width: `${Math.max(0, Math.min(1, b)) * 100}%`,
  height: '100%',
  background: balanceColor(b),
  transition: 'width 80ms linear, background-color 120ms linear',
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

const recordingBadge: React.CSSProperties = {
  position: 'fixed',
  top: '1.2rem',
  left: '1.2rem',
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.35rem 0.7rem',
  background: 'rgba(120, 20, 20, 0.55)',
  border: '1px solid rgba(255, 120, 120, 0.7)',
  borderRadius: '999px',
  color: '#ffd6d6',
  fontSize: 'clamp(0.7rem, 1.4vw, 0.85rem)',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  textShadow: '0 1px 4px rgba(0,0,0,0.8)',
  backdropFilter: 'blur(4px)',
  pointerEvents: 'none',
};

const recordingDot: React.CSSProperties = {
  width: '0.55rem',
  height: '0.55rem',
  borderRadius: '50%',
  background: '#ff4d4d',
  boxShadow: '0 0 6px #ff4d4d',
  animation: 'bws-rec-blink 1.1s ease-in-out infinite',
};

const previewingBadge: React.CSSProperties = {
  position: 'fixed',
  top: '1.2rem',
  left: '1.2rem',
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.35rem 0.7rem',
  background: 'rgba(20, 90, 50, 0.55)',
  border: '1px solid rgba(120, 220, 160, 0.7)',
  borderRadius: '999px',
  color: '#d6ffe2',
  fontSize: 'clamp(0.7rem, 1.4vw, 0.85rem)',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  textShadow: '0 1px 4px rgba(0,0,0,0.8)',
  backdropFilter: 'blur(4px)',
  pointerEvents: 'none',
};

const previewingDot: React.CSSProperties = {
  width: '0.55rem',
  height: '0.55rem',
  borderRadius: '50%',
  background: '#4dff8a',
  boxShadow: '0 0 6px #4dff8a',
};

const exitPreviewBtn: React.CSSProperties = {
  position: 'fixed',
  top: '1.2rem',
  right: '1.5rem',
  padding: '0.5rem 0.9rem',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  fontSize: 'clamp(0.8rem, 1.6vw, 0.95rem)',
  fontWeight: 700,
  color: '#0a1622',
  background: '#43d6ff',
  border: '1px solid #43d6ff',
  borderRadius: '0.4rem',
  cursor: 'pointer',
  pointerEvents: 'auto',
  textShadow: 'none',
  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
  zIndex: 40,
};

const PULSE_KEYFRAMES = `@keyframes bws-pulse {
  0%, 100% { opacity: 0.7; transform: translateY(-50%) scale(1); }
  50%      { opacity: 1;   transform: translateY(-50%) scale(1.06); }
}
@keyframes bws-rec-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}
@keyframes bws-notif-in {
  0%   { opacity: 0; transform: translateY(8px) scale(0.92); }
  60%  { opacity: 1; transform: translateY(0)   scale(1.04); }
  100% { opacity: 1; transform: translateY(0)   scale(1); }
}
@keyframes bws-notif-out {
  0%   { opacity: 1; }
  100% { opacity: 0; }
}`;

function NotificationItem({ notification }: { notification: NotificationState }) {
  const fadeMs = Math.min(800, Math.max(250, notification.durationMs * 0.35));
  const holdMs = Math.max(0, notification.durationMs - fadeMs);
  const scale = Math.min(notification.scale, NOTIF_MAX_SCALE);
  return (
    <div
      style={{
        ...notifText(scale),
        animation: `bws-notif-in 280ms ease-out both, bws-notif-out ${fadeMs}ms ${holdMs}ms ease-in forwards`,
      }}
    >
      {notification.text}
      {notification.points > 0 && (
        <span style={notifPoints}>+{notification.points}</span>
      )}
    </div>
  );
}

function NotificationStack({ notifications }: { notifications: NotificationState[] }) {
  if (notifications.length === 0) return null;
  return (
    <div style={notifStack}>
      {notifications.map((n) => (
        <NotificationItem key={n.id} notification={n} />
      ))}
    </div>
  );
}

// 1 game unit ≈ 0.3 m  (wave height 50 u ≈ 15 m real-world big wave)
const UNITS_TO_MS = 0.3;

function StatsPanel({
  stats, rideTime, starsCollected, starsTotal, starsRequired, trickScore,
}: {
  stats: RunStats;
  rideTime: number;
  starsCollected: number;
  starsTotal: number;
  starsRequired: number;
  trickScore: number;
}) {
  const score = finalScore(trickScore, starsCollected, starsTotal, rideTime);
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
      <div>Tricks: <strong>{trickScore}</strong></div>
      <div style={{ marginTop: '0.4rem', fontSize: '1.15em' }}>
        Score: <strong style={{ color: '#ffe14a' }}>{score}</strong>
      </div>
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
  status, level, wireframe, showAdvancedOptions, showMenuButton,
  notifications, recording, previewing,
  onToggleWireframe,
  onRetry, onNextLevel, onExit, onExitPreview, hasNextLevel,
}: Props) {
  const {
    phase, rideTime, speed, progress, stats, trickScore, balance,
    starsCollected, starsTotal, starsRequired, starsMissed,
  } = status;
  const speedMs = (speed * UNITS_TO_MS).toFixed(1);

  if (phase === 'surfing') {
    return (
      <>
        <style>{PULSE_KEYFRAMES}</style>
        {recording && (
          <div style={recordingBadge}>
            <span style={recordingDot} />
            <span>Recording</span>
          </div>
        )}
        {previewing && (
          <>
            <div style={previewingBadge}>
              <span style={previewingDot} />
              <span>Previewing</span>
            </div>
            <button type="button" style={exitPreviewBtn} onClick={onExitPreview}>
              Exit preview
            </button>
          </>
        )}
        {starsMissed > 0 && (
          <div style={missedWarning}>
            ★ {starsMissed} missed
          </div>
        )}
        {showAdvancedOptions && (
          <>
            <div style={balanceWrap}>
              <div style={balanceLabel}>Balance</div>
              <div style={balanceTrack}>
                <div style={balanceFill(balance)} />
              </div>
            </div>
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
              &nbsp;·&nbsp; <span style={{ color: '#ffe14a', fontWeight: 600 }}>{trickScore} pts</span>
            </div>
            <div style={topRightStack}>
              <button type="button" style={topRightButton} onClick={onToggleWireframe}>
                Wireframe: {wireframe ? 'ON' : 'OFF'}
              </button>
              {showMenuButton && (
                <button type="button" style={topRightButton} onClick={onExit}>
                  Menu
                </button>
              )}
            </div>
          </>
        )}
        <NotificationStack notifications={notifications} />
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
  } else if (phase === 'no_stars') {
    title = 'NOT ENOUGH STARS';
    accent = { color: '#ffdf6a' };
  } else if (phase === 'completed') {
    title = 'WAVE COMPLETED';
    accent = { color: '#bfffce' };
    if (previewing) {
      primaryLabel = 'Back to editor';
      primaryAction = onExitPreview;
    } else {
      primaryLabel = hasNextLevel ? 'Next level' : 'Back to menu';
      primaryAction = hasNextLevel ? onNextLevel : onExit;
    }
  }

  return (
    <>
      {previewing && (
        <button type="button" style={exitPreviewBtn} onClick={onExitPreview}>
          Exit preview
        </button>
      )}
      <div style={overlay}>
        <div style={{ ...big, ...accent }}>{title}</div>
        <div style={sub}>{level.name}</div>
        <StatsPanel
          stats={stats}
          rideTime={rideTime}
          starsCollected={starsCollected}
          starsTotal={starsTotal}
          starsRequired={starsRequired}
          trickScore={trickScore}
        />
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', pointerEvents: 'auto' }}>
          <button type="button" style={topRightButton} onClick={primaryAction}>
            {primaryLabel}
          </button>
          {phase === 'completed' && !previewing && hasNextLevel && (
            <button type="button" style={topRightButton} onClick={onRetry}>
              Retry
            </button>
          )}
          {previewing && phase !== 'completed' && (
            <button type="button" style={topRightButton} onClick={onRetry}>
              Retry preview
            </button>
          )}
          <button type="button" style={topRightButton} onClick={onExit}>
            Menu
          </button>
        </div>
      </div>
    </>
  );
}
