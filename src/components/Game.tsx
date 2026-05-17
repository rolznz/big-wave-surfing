import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createScene } from "../game/createScene";
import { createLoop, GameStatus, TouchIndicatorState } from "../game/loop";
import { LevelConfig, LEVELS, levelGoalX } from "../game/levels";
import { NOTIF_PADDLE_MS, NOTIF_SCALE_PADDLE } from "../game/constants";
import { Cosmetics } from "../game/cosmetics";
import HUD, { type NotificationState } from "./HUD";
import TouchIndicator from "./TouchIndicator";

interface Props {
  level: LevelConfig;
  onPickLevel: (level: LevelConfig) => void;
  onExit: () => void;
  showAdvancedOptions: boolean;
  autoStand: boolean;
  showMenuButton: boolean;
  cosmetics: Cosmetics;
}

function initialStatus(level: LevelConfig): GameStatus {
  return {
    phase: "surfing",
    stance: "prone",
    cameraMode: "fixed",
    rideTime: 0,
    speed: 0,
    progress: 0,
    goalX: levelGoalX(level),
    trickScore: 0,
    balance: 1,
    stats: { maxSpeed: 0, avgSpeed: 0, turns: 0 },
  };
}

export default function Game({
  level,
  onPickLevel,
  onExit,
  showAdvancedOptions,
  autoStand,
  showMenuButton,
  cosmetics,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toggleWireframeRef = useRef<() => boolean>(() => false);
  const autoStandRef = useRef<boolean>(autoStand);
  const cosmeticsRef = useRef<Cosmetics>(cosmetics);
  cosmeticsRef.current = cosmetics;

  const [runKey, setRunKey] = useState(0);
  const [status, setStatus] = useState<GameStatus>(() => initialStatus(level));
  const [wireframe, setWireframe] = useState(false);
  const [touchIndicator, setTouchIndicator] =
    useState<TouchIndicatorState | null>(null);
  const [notifications, setNotifications] = useState<NotificationState[]>([]);

  const notifIdRef = useRef(0);
  const notifTimersRef = useRef<number[]>([]);

  useEffect(() => {
    setStatus(initialStatus(level));
  }, [level, runKey]);

  useEffect(() => {
    autoStandRef.current = autoStand;
  }, [autoStand]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    notifTimersRef.current.forEach((t) => clearTimeout(t));
    notifTimersRef.current = [];
    setNotifications([]);

    function showTrick(
      text: string,
      durationMs: number,
      points: number,
      scale: number,
    ) {
      notifIdRef.current += 1;
      const id = notifIdRef.current;
      setNotifications((prev) =>
        [...prev, { id, text, durationMs, points, scale }].slice(
          Math.max(prev.length - 4, 0),
        ),
      );
      const timer = window.setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        notifTimersRef.current = notifTimersRef.current.filter(
          (t) => t !== timer,
        );
      }, durationMs);
      notifTimersRef.current.push(timer);
    }

    const bs = createScene(canvas);
    const loop = createLoop(bs, setStatus, level, {
      autoStand: autoStandRef,
      onTouchIndicator: setTouchIndicator,
      onTrick: showTrick,
      cosmetics: cosmeticsRef.current,
    });
    toggleWireframeRef.current = loop.toggleWireframe;

    showTrick("PADDLE!", NOTIF_PADDLE_MS, 0, NOTIF_SCALE_PADDLE);

    return () => {
      loop.stop();
      bs.dispose();
      setTouchIndicator(null);
      notifTimersRef.current.forEach((t) => clearTimeout(t));
      notifTimersRef.current = [];
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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat) return;
      if (e.key === "r" || e.key === "R") {
        retry();
        return;
      }
      if (e.key === "Enter") {
        if (status.phase === "completed") {
          goNextLevel();
        } else if (status.phase !== "surfing") {
          retry();
        }
        return;
      }
      if (e.key === "Escape" || e.key === "m" || e.key === "M") {
        onExit();
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status.phase, retry, goNextLevel, onExit]);

  const onToggleWireframe = useCallback(() => {
    setWireframe(toggleWireframeRef.current());
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100vw", height: "100vh" }}
      />
      <HUD
        status={status}
        level={level}
        wireframe={wireframe}
        showAdvancedOptions={showAdvancedOptions}
        showMenuButton={showMenuButton}
        notifications={notifications}
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
