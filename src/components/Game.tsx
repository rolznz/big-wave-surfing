import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createScene } from '../game/createScene';
import { createLoop, GameStatus, TouchIndicatorState } from '../game/loop';
import {
  LevelConfig, LEVELS, levelGoalX, levelNumStars, levelMinStars,
} from '../game/levels';
import { NOTIF_PADDLE_MS, NOTIF_SCALE_PADDLE } from '../game/constants';
import HUD, { type NotificationState } from './HUD';
import LevelEditor, {
  type EditorPathPoint, type PlacedStar, type PlacedRock, buildEditedLevel,
} from './LevelEditor';
import TouchIndicator from './TouchIndicator';

interface Props {
  level: LevelConfig;
  onPickLevel: (level: LevelConfig) => void;
  onExit: () => void;
  showAdvancedOptions: boolean;
  autoStand: boolean;
  showMenuButton: boolean;
  editorMode: boolean;
}

// Three views available when editorMode is on. Outside editor mode, view is
// effectively always 'preview' (just regular gameplay using `level` as-is).
//   recording — empty wave; path is captured per frame; HUD shows RECORDING.
//   editor    — top-down + side-view plot overlay; click to place stars/rocks.
//   preview   — full play of the assembled level so the designer can feel it.
type EditorView = 'recording' | 'editor' | 'preview';

function initialStatus(level: LevelConfig): GameStatus {
  const total = levelNumStars(level);
  return {
    phase: 'surfing',
    stance: 'prone',
    cameraMode: 'fixed',
    rideTime: 0,
    speed: 0,
    progress: 0,
    goalX: levelGoalX(level),
    starsCollected: 0,
    starsTotal: total,
    starsRequired: levelMinStars(level),
    starsMissed: 0,
    trickScore: 0,
    balance: 1,
    stats: { maxSpeed: 0, avgSpeed: 0, turns: 0 },
  };
}

export default function Game({ level, onPickLevel, onExit, showAdvancedOptions, autoStand, showMenuButton, editorMode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toggleWireframeRef = useRef<() => boolean>(() => false);
  const autoStandRef = useRef<boolean>(autoStand);

  const [runKey, setRunKey] = useState(0);
  const [view, setView] = useState<EditorView>(editorMode ? 'recording' : 'preview');
  const [previewLevel, setPreviewLevel] = useState<LevelConfig | null>(null);

  // Editor recording-run config: empty wave so the surfer's path captures freely.
  const recordingLevel = useMemo<LevelConfig>(() => {
    if (!editorMode) return level;
    return {
      ...level,
      obstaclePlacements: undefined,
      starPlacements: undefined,
      minStars: 0,
    };
  }, [level, editorMode]);

  // The level actually fed to the loop. In 'preview' view of editor mode we
  // run the assembled level; everywhere else we run the (empty) recording
  // clone, which is identical to the original `level` outside editor mode.
  const activeLevel: LevelConfig = useMemo(() => {
    if (editorMode && view === 'preview' && previewLevel) return previewLevel;
    return recordingLevel;
  }, [editorMode, view, previewLevel, recordingLevel]);

  const [status, setStatus] = useState<GameStatus>(() => initialStatus(activeLevel));
  const [wireframe, setWireframe] = useState(false);
  const [touchIndicator, setTouchIndicator] = useState<TouchIndicatorState | null>(null);
  const [notifications, setNotifications] = useState<NotificationState[]>([]);

  // Recording-run path. Reset only when starting a new recording (not when
  // bouncing through preview).
  const pathRef = useRef<EditorPathPoint[]>([]);
  const [completedPath, setCompletedPath] = useState<EditorPathPoint[] | null>(null);

  // Editor placements live up here so a preview round-trip doesn't wipe them.
  const [stars, setStars] = useState<PlacedStar[]>([]);
  const [rocks, setRocks] = useState<PlacedRock[]>([]);

  const notifIdRef = useRef(0);
  const notifTimersRef = useRef<number[]>([]);

  // Reset status on every loop remount. Also reset the path *only* when we're
  // about to record (i.e. view === 'recording'); preview round-trips must
  // preserve completedPath and placements.
  useEffect(() => {
    setStatus(initialStatus(activeLevel));
    if (view === 'recording') {
      pathRef.current = [];
      setCompletedPath(null);
    }
  }, [activeLevel, runKey, view]);

  useEffect(() => {
    autoStandRef.current = autoStand;
  }, [autoStand]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    notifTimersRef.current.forEach((t) => clearTimeout(t));
    notifTimersRef.current = [];
    setNotifications([]);

    function showTrick(text: string, durationMs: number, points: number, scale: number) {
      notifIdRef.current += 1;
      const id = notifIdRef.current;
      setNotifications((prev) => [...prev, { id, text, durationMs, points, scale }]);
      const timer = window.setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        notifTimersRef.current = notifTimersRef.current.filter((t) => t !== timer);
      }, durationMs);
      notifTimersRef.current.push(timer);
    }

    const bs = createScene(canvas);
    const handleStatus = (next: GameStatus) => {
      setStatus((prev) => {
        // Recording → completed: snapshot path and pop into the editor view.
        if (editorMode
          && view === 'recording'
          && prev.phase === 'surfing'
          && next.phase === 'completed') {
          setCompletedPath(pathRef.current.slice());
          setView('editor');
        }
        return next;
      });
    };
    const loop = createLoop(bs, handleStatus, activeLevel, {
      autoStand: autoStandRef,
      onTouchIndicator: setTouchIndicator,
      onTrick: showTrick,
      onEditorFrame: editorMode && view === 'recording'
        ? (f) => { pathRef.current.push(f); }
        : undefined,
    });
    toggleWireframeRef.current = loop.toggleWireframe;

    showTrick('PADDLE!', NOTIF_PADDLE_MS, 0, NOTIF_SCALE_PADDLE);

    return () => {
      loop.stop();
      bs.dispose();
      setTouchIndicator(null);
      notifTimersRef.current.forEach((t) => clearTimeout(t));
      notifTimersRef.current = [];
    };
  }, [activeLevel, runKey, editorMode, view]);

  const retry = useCallback(() => setRunKey((k) => k + 1), []);

  const nextLevelIndex = useMemo(() => {
    const i = LEVELS.findIndex((l) => l.id === level.id);
    return i >= 0 && i < LEVELS.length - 1 ? i + 1 : -1;
  }, [level.id]);
  const hasNextLevel = nextLevelIndex >= 0;
  const goNextLevel = useCallback(() => {
    if (hasNextLevel) onPickLevel(LEVELS[nextLevelIndex]);
    else onExit();
  }, [hasNextLevel, nextLevelIndex, onPickLevel, onExit]);

  // Editor-only transitions
  const reRecord = useCallback(() => {
    if (!editorMode) return;
    setStars([]);
    setRocks([]);
    setCompletedPath(null);
    pathRef.current = [];
    setPreviewLevel(null);
    setView('recording');
    setRunKey((k) => k + 1);
  }, [editorMode]);

  const startPreview = useCallback(() => {
    if (!editorMode) return;
    setPreviewLevel(buildEditedLevel(level, stars, rocks));
    setView('preview');
    setRunKey((k) => k + 1);
  }, [editorMode, level, stars, rocks]);

  const exitPreview = useCallback(() => {
    if (!editorMode) return;
    setPreviewLevel(null);
    setView('editor');
    setRunKey((k) => k + 1);
  }, [editorMode]);

  // While the editor overlay is up, suppress in-game hotkeys.
  const editorOpen = editorMode && view === 'editor' && completedPath !== null;
  const previewing = editorMode && view === 'preview';

  useEffect(() => {
    if (editorOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.repeat) return;
      if (previewing && (e.key === 'Escape' || e.key === 'p' || e.key === 'P')) {
        exitPreview();
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        if (previewing) {
          // In preview, R restarts the preview (a fresh play of the assembled level).
          retry();
        } else {
          retry();
        }
        return;
      }
      if (e.key === 'Enter') {
        if (status.phase === 'completed') {
          if (previewing) exitPreview();
          else goNextLevel();
        } else if (status.phase !== 'surfing') {
          retry();
        }
        return;
      }
      if (e.key === 'Escape' || e.key === 'm' || e.key === 'M') {
        onExit();
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status.phase, retry, goNextLevel, onExit, editorOpen, previewing, exitPreview]);

  const onToggleWireframe = useCallback(() => {
    setWireframe(toggleWireframeRef.current());
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100vw', height: '100vh' }}
      />
      {!editorOpen && (
        <HUD
          status={status}
          level={previewing && previewLevel ? previewLevel : level}
          wireframe={wireframe}
          showAdvancedOptions={showAdvancedOptions}
          showMenuButton={showMenuButton}
          notifications={notifications}
          editorMode={editorMode}
          recording={editorMode && view === 'recording'}
          previewing={previewing}
          onToggleWireframe={onToggleWireframe}
          onRetry={retry}
          onNextLevel={goNextLevel}
          onExit={onExit}
          onExitPreview={exitPreview}
          hasNextLevel={hasNextLevel}
        />
      )}
      <TouchIndicator state={touchIndicator} />
      {editorOpen && completedPath && (
        <LevelEditor
          base={level}
          path={completedPath}
          stars={stars}
          rocks={rocks}
          onStarsChange={setStars}
          onRocksChange={setRocks}
          onPreview={startPreview}
          onRestart={reRecord}
          onExit={onExit}
        />
      )}
    </>
  );
}
