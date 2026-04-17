import { useEffect, useRef, useState } from 'react';
import { createScene } from '../game/createScene';
import { createLoop, GameStatus } from '../game/loop';
import HUD from './HUD';

const INITIAL_STATUS: GameStatus = {
  phase: 'surfing',
  stance: 'prone',
  rideTime: 0,
  speed: 0,
};

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<GameStatus>(INITIAL_STATUS);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const bs = createScene(canvas);
    const stop = createLoop(bs, setStatus);

    return () => {
      stop();
      bs.dispose();
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100vw', height: '100vh' }}
      />
      <HUD status={status} />
    </>
  );
}
