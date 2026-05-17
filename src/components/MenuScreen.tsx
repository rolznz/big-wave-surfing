import { useEffect, useState } from 'react';
import { LEVELS, LevelConfig } from '../game/levels';
import { isTouchPrimary } from '../util/isTouchPrimary';
import {
  BOARDS,
  CHARACTERS,
  Cosmetics,
  StanceVariant,
} from '../game/cosmetics';
import CharacterPreview from './CharacterPreview';

interface Props {
  onPlay: (level: LevelConfig) => void;
  showAdvancedOptions: boolean;
  onChangeShowAdvancedOptions: (v: boolean) => void;
  autoStand: boolean;
  onChangeAutoStand: (v: boolean) => void;
  showHotkeys: boolean;
  onChangeShowHotkeys: (v: boolean) => void;
  showMenuButton: boolean;
  onChangeShowMenuButton: (v: boolean) => void;
  cosmetics: Cosmetics;
  onChangeCosmetics: (next: Cosmetics) => void;
}

const wrap: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
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
  marginTop: '-0.5rem',
};

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))',
  gap: '1rem',
  width: '100%',
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

const previewPanel: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  minHeight: 'min(70vh, 600px)',
  background:
    'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '0.8rem',
  overflow: 'hidden',
};

const previewPanelNarrow: React.CSSProperties = {
  ...previewPanel,
  height: 'clamp(180px, 30vh, 260px)',
  minHeight: 0,
};

const customizeRow: React.CSSProperties = {
  marginTop: '1rem',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  justifyContent: 'flex-start',
};

const customizePanel: React.CSSProperties = {
  marginTop: '0.8rem',
  padding: '1rem 1.1rem',
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: '0.6rem',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
};

const customizeLabel: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  opacity: 0.75,
  marginBottom: '0.4rem',
};

const tileStrip: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
};

const tileBase: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.3rem',
  padding: '0.5rem 0.6rem',
  background: 'rgba(255,255,255,0.05)',
  border: '2px solid transparent',
  borderRadius: '0.4rem',
  cursor: 'pointer',
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '0.75rem',
  minWidth: '4.5rem',
};

const tileSelected: React.CSSProperties = {
  borderColor: '#7fd8f5',
  background: 'rgba(127,216,245,0.12)',
};

const segmentWrap: React.CSSProperties = {
  display: 'inline-flex',
  borderRadius: '0.4rem',
  overflow: 'hidden',
  border: '1px solid rgba(255,255,255,0.3)',
};

const segmentButton: React.CSSProperties = {
  padding: '0.5rem 1rem',
  background: 'transparent',
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
};

const segmentButtonSelected: React.CSSProperties = {
  ...segmentButton,
  background: 'rgba(127,216,245,0.25)',
};

function difficultyStars(l: LevelConfig): string {
  const filled = Math.max(0, Math.min(5, l.difficulty));
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

function useIsNarrow(maxWidthPx = 800): boolean {
  const [narrow, setNarrow] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidthPx}px)`);
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [maxWidthPx]);
  return narrow;
}

function colorHex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

export default function MenuScreen({
  onPlay,
  showAdvancedOptions,
  onChangeShowAdvancedOptions,
  autoStand,
  onChangeAutoStand,
  showHotkeys,
  onChangeShowHotkeys,
  showMenuButton,
  onChangeShowMenuButton,
  cosmetics,
  onChangeCosmetics,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const narrow = useIsNarrow(800);

  const setCharacter = (id: string) =>
    onChangeCosmetics({ ...cosmetics, characterId: id });
  const setBoard = (id: string) =>
    onChangeCosmetics({ ...cosmetics, boardId: id });
  const setStance = (stance: StanceVariant) =>
    onChangeCosmetics({ ...cosmetics, stance });

  const customizeBlock = (
    <>
      <div style={customizeRow}>
        <button
          type="button"
          style={topRightButton}
          onClick={() => setCustomizeOpen((v) => !v)}
          aria-expanded={customizeOpen}
        >
          🎨 {customizeOpen ? 'Hide' : 'Customize'}
        </button>
      </div>
      {customizeOpen && (
        <div style={customizePanel}>
          <div>
            <div style={customizeLabel}>Character</div>
            <div style={tileStrip}>
              {CHARACTERS.map((c) => {
                const selected = c.id === cosmetics.characterId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCharacter(c.id)}
                    style={{
                      ...tileBase,
                      ...(selected ? tileSelected : undefined),
                    }}
                  >
                    <div style={{ display: 'flex', gap: '0.2rem' }}>
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          background: colorHex(c.skin),
                          border: '1px solid rgba(0,0,0,0.4)',
                        }}
                      />
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          background: colorHex(c.suit),
                          border: '1px solid rgba(0,0,0,0.4)',
                        }}
                      />
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          background: colorHex(c.hair),
                          border: '1px solid rgba(0,0,0,0.4)',
                        }}
                      />
                    </div>
                    <span>{c.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={customizeLabel}>Board</div>
            <div style={tileStrip}>
              {BOARDS.map((b) => {
                const selected = b.id === cosmetics.boardId;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBoard(b.id)}
                    style={{
                      ...tileBase,
                      ...(selected ? tileSelected : undefined),
                    }}
                  >
                    <span
                      style={{
                        width: 36,
                        height: 14,
                        borderRadius: '7px',
                        background: colorHex(b.color),
                        border: '1px solid rgba(0,0,0,0.4)',
                      }}
                    />
                    <span>{b.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={customizeLabel}>Stance</div>
            <div style={segmentWrap}>
              <button
                type="button"
                onClick={() => setStance('regular')}
                style={
                  cosmetics.stance === 'regular'
                    ? segmentButtonSelected
                    : segmentButton
                }
              >
                Regular
              </button>
              <button
                type="button"
                onClick={() => setStance('goofy')}
                style={
                  cosmetics.stance === 'goofy'
                    ? segmentButtonSelected
                    : segmentButton
                }
              >
                Goofy
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const previewBlock = (
    <div style={narrow ? previewPanelNarrow : previewPanel}>
      <CharacterPreview cosmetics={cosmetics} />
    </div>
  );

  const leftColumn = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'clamp(0.8rem, 2vw, 1.4rem)',
        minWidth: 0,
        flex: '1 1 0',
      }}
    >
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
              (e.currentTarget as HTMLButtonElement).style.transform =
                'translateY(-2px)';
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                'rgba(255,255,255,0.55)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = '';
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                'rgba(255,255,255,0.25)';
            }}
          >
            <div style={cardName}>{level.name}</div>
            <div style={cardDesc}>{level.description}</div>
            <div style={cardMeta}>Difficulty {difficultyStars(level)}</div>
          </button>
        ))}
      </div>
    </div>
  );

  const rightColumn = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: narrow ? '1 1 0' : '0 0 38%',
        maxWidth: narrow ? undefined : '480px',
        minWidth: narrow ? 0 : 300,
      }}
    >
      {previewBlock}
      {customizeBlock}
    </div>
  );

  return (
    <div style={wrap}>
      <div
        style={{
          display: 'flex',
          flexDirection: narrow ? 'column' : 'row',
          gap: 'clamp(1rem, 2.5vw, 2rem)',
          alignItems: 'stretch',
          width: '100%',
          maxWidth: '1400px',
          margin: '0 auto',
        }}
      >
        {narrow ? (
          <>
            {rightColumn}
            {leftColumn}
          </>
        ) : (
          <>
            {leftColumn}
            {rightColumn}
          </>
        )}
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
                  <th
                    style={{
                      ...controlsTh,
                      ...(isTouchPrimary ? colDim : colHighlight),
                    }}
                  >
                    Keyboard
                  </th>
                  <th
                    style={{
                      ...controlsTh,
                      ...(isTouchPrimary ? colHighlight : colDim),
                    }}
                  >
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
                    <td
                      style={{
                        ...controlsTd,
                        ...(isTouchPrimary ? colDim : colHighlight),
                      }}
                    >
                      {kb}
                    </td>
                    <td
                      style={{
                        ...controlsTd,
                        ...(isTouchPrimary ? colHighlight : colDim),
                      }}
                    >
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
            <label style={{ ...settingRow, marginBottom: '0.7rem' }}>
              <input
                type="checkbox"
                checked={showHotkeys}
                onChange={(e) => onChangeShowHotkeys(e.target.checked)}
              />
              Show keyboard hotkeys in HUD
            </label>
            <label style={{ ...settingRow, marginBottom: '0.7rem' }}>
              <input
                type="checkbox"
                checked={showMenuButton}
                onChange={(e) => onChangeShowMenuButton(e.target.checked)}
              />
              Show Menu button in HUD
            </label>
            <label style={settingRow}>
              <input
                type="checkbox"
                checked={showAdvancedOptions}
                onChange={(e) => onChangeShowAdvancedOptions(e.target.checked)}
              />
              Show advanced options on HUD
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
