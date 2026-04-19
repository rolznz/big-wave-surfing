import { useState } from 'react';
import { LEVELS, LevelConfig } from '../game/levels';

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
  justifyContent: 'center',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  color: '#fff',
  background: 'linear-gradient(180deg, #053047 0%, #0a5f86 55%, #0e85a8 100%)',
  padding: '2rem',
  gap: '2rem',
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
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 320px))',
  gap: '1rem',
  width: 'min(90vw, 1100px)',
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

const settingsButton: React.CSSProperties = {
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
  textShadow: '0 1px 4px rgba(0,0,0,0.8)',
  backdropFilter: 'blur(4px)',
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

  return (
    <div style={wrap}>
      <button
        type="button"
        style={settingsButton}
        onClick={() => setSettingsOpen(true)}
        aria-label="Settings"
      >
        ⚙ Settings
      </button>
      <h1 style={title}>Big Wave Surfing</h1>
      <div style={subtitle}>Pick a wave.</div>
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
