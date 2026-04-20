import { useState } from 'react';
import { LEVELS, LevelConfig } from '../game/levels';
import { isTouchPrimary } from '../util/isTouchPrimary';

interface Props {
  onPlay: (level: LevelConfig) => void;
  showAdvancedOptions: boolean;
  onChangeShowAdvancedOptions: (v: boolean) => void;
  autoStand: boolean;
  onChangeAutoStand: (v: boolean) => void;
}

const wrap: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  color: '#fff',
  background: 'linear-gradient(180deg, #053047 0%, #0a5f86 55%, #0e85a8 100%)',
  padding: 'clamp(1rem, 3vw, 2rem)',
  gap: 'clamp(1rem, 3vw, 2rem)',
  overflowY: 'auto',
};

const title: React.CSSProperties = {
  fontSize: 'clamp(2rem, 6vw, 4rem)',
  fontWeight: 800,
  letterSpacing: '0.04em',
  textShadow: '0 3px 10px rgba(0,0,0,0.6)',
  margin: 0,
};

const subtitle: React.CSSProperties = {
  fontSize: 'clamp(0.9rem, 2vw, 1.1rem)',
  opacity: 0.85,
  textShadow: '0 2px 6px rgba(0,0,0,0.5)',
  marginTop: '-1rem',
};

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 20rem))',
  gap: '1rem',
  width: 'min(100%, 1100px)',
  justifyContent: 'center',
};

const card: React.CSSProperties = {
  textAlign: 'left',
  padding: '1.2rem 1.4rem',
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(255,255,255,0.25)',
  borderRadius: '0.6rem',
  color: '#fff',
  fontFamily: 'inherit',
  cursor: 'pointer',
  backdropFilter: 'blur(4px)',
  transition: 'transform 120ms ease, border-color 120ms ease',
};

const cardName: React.CSSProperties = {
  fontSize: '1.2rem',
  fontWeight: 700,
  marginBottom: '0.4rem',
};

const cardDesc: React.CSSProperties = {
  fontSize: '0.9rem',
  opacity: 0.85,
  lineHeight: 1.4,
  marginBottom: '0.7rem',
};

const cardMeta: React.CSSProperties = {
  fontSize: '0.75rem',
  opacity: 0.7,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const topRightBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexWrap: 'wrap',
  justifyContent: 'center',
};

const topRightButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.5rem 0.9rem',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  fontSize: 'clamp(0.8rem, 1.8vw, 1rem)',
  color: '#fff',
  background: 'rgba(0, 0, 0, 0.35)',
  border: '1px solid rgba(255, 255, 255, 0.4)',
  borderRadius: '0.4rem',
  cursor: 'pointer',
  textShadow: '0 1px 4px rgba(0,0,0,0.8)',
  backdropFilter: 'blur(4px)',
  textDecoration: 'none',
  lineHeight: 1,
};

const modalBackdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backdropFilter: 'blur(2px)',
  zIndex: 10,
};

const modalPanel: React.CSSProperties = {
  minWidth: 'min(360px, 85vw)',
  padding: '1.5rem 1.75rem',
  background: 'rgba(8, 40, 60, 0.92)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  borderRadius: '0.6rem',
  color: '#fff',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  textShadow: '0 1px 4px rgba(0,0,0,0.8)',
};

const modalTitle: React.CSSProperties = {
  margin: 0,
  fontSize: '1.3rem',
  fontWeight: 700,
  letterSpacing: '0.03em',
  marginBottom: '1.2rem',
};

const settingRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  fontSize: '1rem',
  cursor: 'pointer',
  userSelect: 'none',
};

const modalClose: React.CSSProperties = {
  marginTop: '1.4rem',
  padding: '0.5rem 1rem',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  fontSize: '0.95rem',
  color: '#fff',
  background: 'rgba(255, 255, 255, 0.12)',
  border: '1px solid rgba(255, 255, 255, 0.4)',
  borderRadius: '0.4rem',
  cursor: 'pointer',
};

const helpPanel: React.CSSProperties = {
  ...modalPanel,
  maxWidth: 'min(34rem, 92vw)',
};

const helpIntro: React.CSSProperties = {
  fontSize: '0.95rem',
  lineHeight: 1.5,
  opacity: 0.9,
  marginBottom: '1.2rem',
};

const controlsTable: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.9rem',
};

const controlsTh: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.4rem 0.6rem',
  borderBottom: '1px solid rgba(255,255,255,0.25)',
  fontWeight: 600,
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  fontSize: '0.75rem',
};

const controlsTd: React.CSSProperties = {
  padding: '0.4rem 0.6rem',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const colDim: React.CSSProperties = {
  opacity: 0.45,
};

const colHighlight: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
};

function difficultyStars(l: LevelConfig): string {
  const filled = Math.max(0, Math.min(5, l.difficulty));
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

export default function MenuScreen({
  onPlay,
  showAdvancedOptions,
  onChangeShowAdvancedOptions,
  autoStand,
  onChangeAutoStand,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div style={wrap}>
      <h1 style={title}>Big Wave Surfing</h1>
      <div style={subtitle}>Pick a wave.</div>
      <div style={topRightBar}>
        <button
          type="button"
          style={topRightButton}
          onClick={() => setHelpOpen(true)}
          aria-label="Help"
        >
          ❓ Help
        </button>
        <button
          type="button"
          style={topRightButton}
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
        >
          ⚙ Settings
        </button>
        <a
          href="https://github.com/rolznz/big-wave-surfing"
          target="_blank"
          rel="noopener noreferrer"
          style={topRightButton}
          aria-label="GitHub repository"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.97 3.22 9.18 7.69 10.67.56.1.77-.24.77-.54 0-.27-.01-.97-.02-1.9-3.13.68-3.79-1.51-3.79-1.51-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.57 0-1.23.44-2.24 1.16-3.03-.12-.29-.5-1.44.11-3 0 0 .95-.3 3.1 1.16.9-.25 1.86-.37 2.82-.38.96.01 1.92.13 2.82.38 2.15-1.46 3.1-1.16 3.1-1.16.61 1.56.23 2.71.11 3 .72.79 1.16 1.8 1.16 3.03 0 4.33-2.64 5.29-5.15 5.56.4.35.76 1.03.76 2.08 0 1.5-.01 2.71-.01 3.08 0 .3.2.65.78.54 4.46-1.49 7.68-5.7 7.68-10.67C23.25 5.48 18.27.5 12 .5z" />
          </svg>
          GitHub
        </a>
      </div>
      <div style={grid}>
        {LEVELS.map((level) => (
          <button
            key={level.id}
            type="button"
            style={card}
            onClick={() => onPlay(level)}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.55)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = '';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.25)';
            }}
          >
            <div style={cardName}>{level.name}</div>
            <div style={cardDesc}>{level.description}</div>
            <div style={cardMeta}>
              Difficulty {difficultyStars(level)}
              {(level.obstacles ?? []).length > 0 && ` · ${(level.obstacles ?? []).reduce((s, o) => s + o.count, 0)} rocks`}
              {(level.numStars ?? 0) > 0 && ` · collect ${level.minStars ?? level.numStars}/${level.numStars} ★`}
            </div>
          </button>
        ))}
      </div>

      {helpOpen && (
        <div style={modalBackdrop} onClick={() => setHelpOpen(false)}>
          <div style={helpPanel} onClick={(e) => e.stopPropagation()}>
            <h2 style={modalTitle}>How to play</h2>
            <p style={helpIntro}>
              Paddle out, pop up at the right moment, and ride the wave to the
              beach. Collect ★ along the way — you need a minimum to complete
              each wave. Don't get crushed by the curl, and don't fall behind:
              if the wave passes you, it's a wipeout.
            </p>
            <table style={controlsTable}>
              <thead>
                <tr>
                  <th style={controlsTh}>Action</th>
                  <th style={{ ...controlsTh, ...(isTouchPrimary ? colDim : colHighlight) }}>
                    Keyboard
                  </th>
                  <th style={{ ...controlsTh, ...(isTouchPrimary ? colHighlight : colDim) }}>
                    Touch
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Paddle / steer', '↑ / W + ← →', 'drag forward — surfer follows your finger'],
                  ['Brake / reverse aim', '↓ / S', 'drag back — surfer faces away from your finger'],
                  ['Pop up · go prone', 'Space', 'two-finger tap'],
                  ['Cycle camera', 'C', 'three-finger tap'],
                  ['Retry', 'R', 'Menu → Retry'],
                ].map(([action, kb, touch]) => (
                  <tr key={action}>
                    <td style={controlsTd}>{action}</td>
                    <td style={{ ...controlsTd, ...(isTouchPrimary ? colDim : colHighlight) }}>
                      {kb}
                    </td>
                    <td style={{ ...controlsTd, ...(isTouchPrimary ? colHighlight : colDim) }}>
                      {touch}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                style={modalClose}
                onClick={() => setHelpOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div style={modalBackdrop} onClick={() => setSettingsOpen(false)}>
          <div style={modalPanel} onClick={(e) => e.stopPropagation()}>
            <h2 style={modalTitle}>Settings</h2>
            <label style={{ ...settingRow, marginBottom: '0.7rem' }}>
              <input
                type="checkbox"
                checked={autoStand}
                onChange={(e) => onChangeAutoStand(e.target.checked)}
              />
              Auto-stand (pop up when fast enough)
            </label>
            <label style={settingRow}>
              <input
                type="checkbox"
                checked={showAdvancedOptions}
                onChange={(e) => onChangeShowAdvancedOptions(e.target.checked)}
              />
              Show advanced options
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                style={modalClose}
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
