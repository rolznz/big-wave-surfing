import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createScene } from '../game/createScene';
import { createLoop, GameStatus, TouchIndicatorState } from '../game/loop';
import { LevelConfig, LEVELS, levelGoalX } from '../game/levels';
import HUD from './HUD';
import TouchIndicator from './TouchIndicator';

interface Props {
  level: LevelConfig;
  onPickLevel: (level: LevelConfig) => void;
  onExit: () => void;
  showAdvancedOptions: boolean;
  autoStand: boolean;
  showHotkeys: boolean;
  showMenuButton: boolean;
}

function initialStatus(level: LevelConfig): GameStatus {
  const total = level.numStars ?? 0;
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
    starsRequired: level.minStars ?? total,
    starsMissed: 0,
    stats: { maxSpeed: 0, avgSpeed: 0, turns: 0 },
  };
}

export default function Game({ level, onPickLevel, onExit, showAdvancedOptions, autoStand, showHotkeys, showMenuButton }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toggleWireframeRef = useRef<() => boolean>(() => false);
  const autoStandRef = useRef<boolean>(autoStand);

  const [runKey, setRunKey] = useState(0);
  const [status, setStatus] = useState<GameStatus>(() => initialStatus(level));
  const [wireframe, setWireframe] = useState(false);
  const [touchIndicator, setTouchIndicator] = useState<TouchIndicatorState | null>(null);

  // Re-initialise status whenever level or runKey changes.
  useEffect(() => {
    setStatus(initialStatus(level));
  }, [level, runKey]);

  useEffect(() => {
    autoStandRef.current = autoStand;
  }, [autoStand]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const bs = createScene(canvas);
    const loop = createLoop(bs, setStatus, level, {
      autoStand: autoStandRef,
      onTouchIndicator: setTouchIndicator,
    });
    toggleWireframeRef.current = loop.toggleWireframe;

    return () => {
      loop.stop();
      bs.dispose();
      setTouchIndicator(null);
    };
  }, [level, runKey]);

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

  // Keyboard: R = retry, Enter = context-sensitive (next level on completed,
  // retry on other end states), Esc/M = menu.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat) return;
      if (e.key === 'r' || e.key === 'R') {
        retry();
        return;
      }
      if (e.key === 'Enter') {
        if (status.phase === 'completed') {
          goNextLevel();
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
  }, [status.phase, retry, goNextLevel, onExit]);

  const onToggleWireframe = useCallback(() => {
    setWireframe(toggleWireframeRef.current());
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100vw', height: '100vh' }}
      />
      <HUD
        status={status}
        level={level}
        wireframe={wireframe}
        showAdvancedOptions={showAdvancedOptions}
        showHotkeys={showHotkeys}
        showMenuButton={showMenuButton}
        onToggleWireframe={onToggleWireframe}
        onRetry={retry}
        onNextLevel={goNextLevel}
        onExit={onExit}
        hasNextLevel={hasNextLevel}
      />
      <TouchIndicator state={touchIndicator} />
    </>
  );
}
