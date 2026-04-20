import type { TouchIndicatorState, TouchMode } from '../game/loop';
import { isTouchPrimary } from '../util/isTouchPrimary';

interface Props {
  state: TouchIndicatorState | null;
}

const RING_RADIUS = 80;
const DEADZONE_RADIUS = 20;
const SVG_HALF = RING_RADIUS + 14;

const MODE_COLOR: Record<TouchMode, string> = {
  paddle: '#bfeaff',
  brake: '#ffc89a',
};
const NEUTRAL_COLOR = 'rgba(255,255,255,0.7)';

export default function TouchIndicator({ state }: Props) {
  if (!state || !isTouchPrimary) return null;

  const { originX, originY, currentX, currentY, mode } = state;

  const rawDx = currentX - originX;
  const rawDy = currentY - originY;
  const len = Math.hypot(rawDx, rawDy);
  const clampScale = len > RING_RADIUS ? RING_RADIUS / len : 1;
  const headX = rawDx * clampScale;
  const headY = rawDy * clampScale;

  const accent = mode ? MODE_COLOR[mode] : NEUTRAL_COLOR;
  const lineColor = mode ? accent : 'rgba(255,255,255,0.45)';

  return (
    <svg
      width={SVG_HALF * 2}
      height={SVG_HALF * 2}
      viewBox={`${-SVG_HALF} ${-SVG_HALF} ${SVG_HALF * 2} ${SVG_HALF * 2}`}
      style={{
        position: 'fixed',
        left: originX,
        top: originY,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        userSelect: 'none',
        overflow: 'visible',
      }}
    >
      <circle
        cx={0}
        cy={0}
        r={RING_RADIUS}
        fill="rgba(255,255,255,0.04)"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth={1.5}
      />
      <circle
        cx={0}
        cy={0}
        r={DEADZONE_RADIUS}
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      <line
        x1={0}
        y1={0}
        x2={headX}
        y2={headY}
        stroke={lineColor}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx={0} cy={0} r={3} fill="rgba(255,255,255,0.7)" />
      <circle
        cx={headX}
        cy={headY}
        r={mode ? 9 : 7}
        fill={mode ? accent : NEUTRAL_COLOR}
        stroke="rgba(0,0,0,0.35)"
        strokeWidth={1}
      />
    </svg>
  );
}
