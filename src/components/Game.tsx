import { useCallback, useEffect, useRef, useState } from 'react';
import { createScene } from '../game/createScene';
import { createLoop, GameStatus } from '../game/loop';
import HUD from './HUD';

const INITIAL_STATUS: GameStatus = {
  phase: 'surfing',
  stance: 'prone',
  cameraMode: 'fixed',
  rideTime: 0,
  speed: 0,
};

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cycleCameraRef = useRef<() => void>(() => {});
  const [status, setStatus] = useState<GameStatus>(INITIAL_STATUS);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const bs = createScene(canvas);
    const loop = createLoop(bs, setStatus);
    cycleCameraRef.current = loop.cycleCameraMode;

    return () => {
      loop.stop();
      bs.dispose();
    };
  }, []);

  const onCycleCamera = useCallback(() => cycleCameraRef.current(), []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100vw', height: '100vh' }}
      />
      <HUD status={status} onCycleCamera={onCycleCamera} />
    </>
  );
}
