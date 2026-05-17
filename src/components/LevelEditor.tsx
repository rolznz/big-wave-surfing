import { useMemo, useRef, useState } from 'react';
import type {
  LevelConfig, ObstaclePlacement, StarPlacement,
} from '../game/levels';
import { levelGoalX, levelWaveParams } from '../game/levels';
import { waveHeightAt } from '../game/wave';

/** Per-frame path sample emitted by the loop's onEditorFrame hook. */
export interface EditorPathPoint {
  x: number;          // world X (along the wave)
  y: number;          // wave surface Y at the surfer's position this frame
  surferY: number;    // surfer's actual Y this frame (airborne lifts above surface)
  z: number;          // world Z
  zOffset: number;    // z - waveZ at this frame; used for the top-down plot
  breakX: number;     // wave's breakX at this frame; needed by waveHeightAt
}

// A star is stored as a fixed world {x, y, z}. We also keep the path frame's
// zOffset around so the marker can be shown on the bottom (top-down) plot
// without re-deriving it. That zOffset is editor-internal and not serialized.
export interface PlacedStar {
  placement: StarPlacement;
  plotZOffset: number;
}

// Same idea for rocks: the canonical placement is world {x, y, z, radius},
// and we remember the zOffset the user clicked at for the top-down marker.
export interface PlacedRock {
  placement: ObstaclePlacement;
  plotZOffset: number;
}

/** Build a LevelConfig from a base level + current placements, the way both
 *  Download JSON and Preview use it. Shared so both produce identical output. */
export function buildEditedLevel(
  base: LevelConfig,
  stars: PlacedStar[],
  rocks: PlacedRock[],
): LevelConfig {
  return {
    ...base,
    id: `${base.id}_edited`,
    name: `${base.name} (edited)`,
    minStars: stars.length,
    obstaclePlacements: rocks.map((r) => r.placement),
    starPlacements: stars.map((s) => s.placement),
  };
}

interface Props {
  base: LevelConfig;
  path: readonly EditorPathPoint[];
  stars: PlacedStar[];
  rocks: PlacedRock[];
  onStarsChange: (next: PlacedStar[]) => void;
  onRocksChange: (next: PlacedRock[]) => void;
  onPreview: () => void;
  onRestart: () => void;
  onExit: () => void;
}

// Top-down plot Z range.
const Z_MIN = -10;
const Z_MAX = 40;
const Z_RANGE = Z_MAX - Z_MIN;

const ROCK_RADIUS = 3;

// Visual marker size (in plot units). Larger than the gameplay collision pad
// so markers are easy to click.
const STAR_MARKER_TOP   = 1.5;  // on top (Y) plot
const STAR_MARKER_BOTTOM = 1.5; // on bottom (zOffset) plot
const ROCK_MARKER_HINT  = 1.2;  // faint hint on top plot

export default function LevelEditor({
  base, path,
  stars, rocks, onStarsChange, onRocksChange,
  onPreview, onRestart, onExit,
}: Props) {
  const [deleteMode, setDeleteMode] = useState(false);
  const [hoverFrameIdx, setHoverFrameIdx] = useState<number | null>(null);
  const topSvgRef = useRef<SVGSVGElement | null>(null);
  const bottomSvgRef = useRef<SVGSVGElement | null>(null);

  const goalX = useMemo(() => levelGoalX(base), [base]);
  const waveP = useMemo(() => levelWaveParams(base), [base]);
  const xMin = 0;
  const xMax = goalX;
  const xRange = xMax - xMin;

  // Top-plot Y axis. Stretches well above peakAmp so airs are visible. A small
  // negative range gives breathing room below sea level.
  const yMin = -5;
  const yMax = Math.max(waveP.peakAmp * 2, 20);
  const yRange = yMax - yMin;

  // Find the path frame whose recorded X is closest to xClick. Linear since
  // path is short (~900 frames) and we only call this on hover/click.
  function nearestFrameIdx(xClick: number): number | null {
    if (path.length === 0) return null;
    let best = 0;
    let bestD = Math.abs(path[0].x - xClick);
    for (let i = 1; i < path.length; i++) {
      const d = Math.abs(path[i].x - xClick);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // ── Coordinate transforms ──────────────────────────────────────────────────

  function topSvgClientToWorld(
    e: React.MouseEvent<SVGSVGElement>,
  ): { x: number; y: number } | null {
    const svg = topSvgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    // viewBox is [xMin, 0, xRange, yRange] with the Y axis inverted at render
    // time (yMax at top). Invert back to world Y.
    return { x: local.x, y: yMax - local.y };
  }

  function bottomSvgClientToWorld(
    e: React.MouseEvent<SVGSVGElement>,
  ): { x: number; zOffset: number } | null {
    const svg = bottomSvgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, zOffset: Z_MAX - local.y };
  }

  // ── Click handlers ─────────────────────────────────────────────────────────

  function onTopPlotClick(e: React.MouseEvent<SVGSVGElement>) {
    if (deleteMode) return;
    const w = topSvgClientToWorld(e);
    if (!w) return;
    if (w.x < xMin || w.x > xMax) return;
    // Stars snap to the recorded path. The click's Y is discarded — only X is
    // used to find the nearest frame, then the star inherits that frame's
    // (x, surferY, z). The path's zOffset is kept for the bottom-plot marker.
    const i = nearestFrameIdx(w.x);
    if (i === null) return;
    const f = path[i];
    onStarsChange([...stars, {
      placement: { x: f.x, y: f.surferY, z: f.z },
      plotZOffset: f.zOffset,
    }]);
  }

  function onBottomPlotClick(e: React.MouseEvent<SVGSVGElement>) {
    if (deleteMode) return;
    const w = bottomSvgClientToWorld(e);
    if (!w) return;
    if (w.x < xMin || w.x > xMax || w.zOffset < Z_MIN || w.zOffset > Z_MAX) return;
    // Rocks bake from (xClick, zOffsetClick) into a fixed world (x, y, z) by
    // looking up the path's waveZ at that X and evaluating waveHeightAt.
    const i = nearestFrameIdx(w.x);
    if (i === null) return;
    const f = path[i];
    const waveZ = f.z - f.zOffset;
    const worldZ = waveZ + w.zOffset;
    const worldY = waveHeightAt(
      worldZ, waveZ, w.x, f.breakX,
      waveP.peakAmp, waveP.sigmaFront, waveP.sigmaBack,
    );
    onRocksChange([...rocks, {
      placement: { x: w.x, y: worldY, z: worldZ, radius: ROCK_RADIUS },
      plotZOffset: w.zOffset,
    }]);
  }

  function removeStar(i: number) {
    if (!deleteMode) return;
    onStarsChange(stars.filter((_, j) => j !== i));
  }
  function removeRock(i: number) {
    if (!deleteMode) return;
    onRocksChange(rocks.filter((_, j) => j !== i));
  }

  function onTopHover(e: React.MouseEvent<SVGSVGElement>) {
    const w = topSvgClientToWorld(e);
    if (!w) { setHoverFrameIdx(null); return; }
    setHoverFrameIdx(nearestFrameIdx(w.x));
  }
  function clearHover() { setHoverFrameIdx(null); }

  // ── Download ───────────────────────────────────────────────────────────────

  function downloadJson() {
    const edited = buildEditedLevel(base, stars, rocks);
    const blob = new Blob([JSON.stringify(edited, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `level-${base.id}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Render data ────────────────────────────────────────────────────────────

  const topViewBox = `${xMin} 0 ${xRange} ${yRange}`;
  const bottomViewBox = `${xMin} 0 ${xRange} ${Z_RANGE}`;

  const topPathD = useMemo(() => {
    if (path.length === 0) return '';
    let d = '';
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const yScreen = yMax - p.surferY;
      d += (i === 0 ? 'M' : 'L') + p.x.toFixed(2) + ',' + yScreen.toFixed(2) + ' ';
    }
    return d;
  }, [path, yMax]);

  const bottomPathD = useMemo(() => {
    if (path.length === 0) return '';
    let d = '';
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const yScreen = Z_MAX - p.zOffset;
      d += (i === 0 ? 'M' : 'L') + p.x.toFixed(2) + ',' + yScreen.toFixed(2) + ' ';
    }
    return d;
  }, [path]);

  // Gridlines
  const xGridLines: number[] = [];
  for (let x = Math.ceil(xMin / 50) * 50; x <= xMax; x += 50) xGridLines.push(x);
  const yGridLines: number[] = [];
  for (let y = Math.ceil(yMin / 10) * 10; y <= yMax; y += 10) yGridLines.push(y);
  const zGridLines: number[] = [];
  for (let z = Math.ceil(Z_MIN / 10) * 10; z <= Z_MAX; z += 10) zGridLines.push(z);

  const hoverFrame = hoverFrameIdx !== null ? path[hoverFrameIdx] : null;

  return (
    <div style={overlayStyle}>
      <div style={topBar}>
        <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
          Level Editor — {base.name}
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <ToolBtn
            label={deleteMode ? 'Delete: ON' : 'Delete'}
            active={deleteMode}
            onClick={() => setDeleteMode((v) => !v)}
            color="#ff8080"
          />
          <div style={countPill}>★ {stars.length}</div>
          <div style={countPill}>● {rocks.length}</div>
          <button type="button" style={btn} onClick={onRestart}>Re-record</button>
          <button type="button" style={primaryBtn} onClick={onPreview}>Preview</button>
          <button type="button" style={btn} onClick={downloadJson}>Download JSON</button>
          <button type="button" style={btn} onClick={onExit}>Menu</button>
        </div>
      </div>

      <div style={plotsWrap}>
        {/* TOP plot — side view (X, Y). Star placement. */}
        <div style={plotContainer}>
          <div style={plotTitle}>Side view (X, Y) — click to drop a ★ at the path</div>
          <svg
            ref={topSvgRef}
            viewBox={topViewBox}
            preserveAspectRatio="none"
            style={svgStyle}
            onClick={onTopPlotClick}
            onMouseMove={onTopHover}
            onMouseLeave={clearHover}
          >
            {xGridLines.map((x) => (
              <line key={`txg-${x}`} x1={x} x2={x} y1={0} y2={yRange}
                stroke="rgba(255,255,255,0.08)" strokeWidth={0.15}
                vectorEffect="non-scaling-stroke" />
            ))}
            {yGridLines.map((yv) => (
              <line key={`tyg-${yv}`} x1={xMin} x2={xMax}
                y1={yMax - yv} y2={yMax - yv}
                stroke="rgba(255,255,255,0.08)" strokeWidth={0.15}
                vectorEffect="non-scaling-stroke" />
            ))}
            {/* Sea level dashed */}
            <line x1={xMin} x2={xMax} y1={yMax} y2={yMax}
              stroke="rgba(120,200,255,0.5)" strokeDasharray="4 4"
              strokeWidth={0.3} vectorEffect="non-scaling-stroke" />
            {/* Crest height dotted */}
            <line x1={xMin} x2={xMax}
              y1={yMax - waveP.peakAmp} y2={yMax - waveP.peakAmp}
              stroke="rgba(255,255,255,0.3)" strokeDasharray="2 5"
              strokeWidth={0.25} vectorEffect="non-scaling-stroke" />

            {/* Surfer Y path */}
            {topPathD && (
              <path d={topPathD} fill="none" stroke="#43d6ff" strokeWidth={1}
                vectorEffect="non-scaling-stroke" opacity={0.9} />
            )}

            {/* Rocks: faint hint markers (not placeable from this plot) */}
            {rocks.map((r, i) => (
              <circle key={`tr-${i}`}
                cx={r.placement.x} cy={yMax - r.placement.y}
                r={ROCK_MARKER_HINT}
                fill="rgba(125,111,96,0.55)" stroke="rgba(255,255,255,0.2)"
                strokeWidth={0.15} vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }}
              />
            ))}

            {/* Stars on top plot */}
            {stars.map((s, i) => (
              <circle key={`ts-${i}`}
                cx={s.placement.x} cy={yMax - s.placement.y}
                r={STAR_MARKER_TOP}
                fill="#ffd23f" stroke="#7a5a00"
                strokeWidth={0.2} vectorEffect="non-scaling-stroke"
                style={{ cursor: deleteMode ? 'pointer' : 'default' }}
                onClick={(e) => { e.stopPropagation(); removeStar(i); }}
              />
            ))}

            {/* Snap preview while hovering */}
            {!deleteMode && hoverFrame && (
              <circle
                cx={hoverFrame.x} cy={yMax - hoverFrame.surferY}
                r={STAR_MARKER_TOP * 0.9}
                fill="none" stroke="#ffd23f" strokeWidth={0.4}
                strokeDasharray="1.5 1.5"
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }}
              />
            )}
          </svg>
          <div style={axisLabelBottom}>X (along wave) →</div>
        </div>

        {/* BOTTOM plot — top-down (X, zOffset). Rock placement. */}
        <div style={plotContainer}>
          <div style={plotTitle}>Top-down (X, zOffset) — click to drop a ● rock</div>
          <svg
            ref={bottomSvgRef}
            viewBox={bottomViewBox}
            preserveAspectRatio="none"
            style={svgStyle}
            onClick={onBottomPlotClick}
          >
            {xGridLines.map((x) => (
              <line key={`bxg-${x}`} x1={x} x2={x} y1={0} y2={Z_RANGE}
                stroke="rgba(255,255,255,0.08)" strokeWidth={0.15}
                vectorEffect="non-scaling-stroke" />
            ))}
            {zGridLines.map((z) => (
              <line key={`bzg-${z}`} x1={xMin} x2={xMax}
                y1={Z_MAX - z} y2={Z_MAX - z}
                stroke="rgba(255,255,255,0.08)" strokeWidth={0.15}
                vectorEffect="non-scaling-stroke" />
            ))}
            {/* Crest line (zOffset = 0) */}
            <line x1={xMin} x2={xMax} y1={Z_MAX} y2={Z_MAX}
              stroke="rgba(255,255,255,0.45)" strokeDasharray="4 4"
              strokeWidth={0.25} vectorEffect="non-scaling-stroke" />

            {/* Recorded path (zOffset over X) */}
            {bottomPathD && (
              <path d={bottomPathD} fill="none" stroke="#43d6ff" strokeWidth={1}
                vectorEffect="non-scaling-stroke" opacity={0.85} />
            )}

            {/* Rocks */}
            {rocks.map((r, i) => (
              <circle key={`br-${i}`}
                cx={r.placement.x} cy={Z_MAX - r.plotZOffset}
                r={r.placement.radius}
                fill="#7d6f60" stroke="#1a1410"
                strokeWidth={0.2} vectorEffect="non-scaling-stroke"
                style={{ cursor: deleteMode ? 'pointer' : 'default' }}
                onClick={(e) => { e.stopPropagation(); removeRock(i); }}
              />
            ))}

            {/* Stars on bottom plot (path's zOffset at snap frame) */}
            {stars.map((s, i) => (
              <circle key={`bs-${i}`}
                cx={s.placement.x} cy={Z_MAX - s.plotZOffset}
                r={STAR_MARKER_BOTTOM}
                fill="#ffd23f" stroke="#7a5a00"
                strokeWidth={0.2} vectorEffect="non-scaling-stroke"
                style={{ cursor: deleteMode ? 'pointer' : 'default' }}
                onClick={(e) => { e.stopPropagation(); removeStar(i); }}
              />
            ))}
          </svg>
          <div style={axisLabelBottom}>X (along wave) →</div>
        </div>
      </div>

      <div style={hint}>
        {deleteMode
          ? 'Delete mode: click a star or rock to remove it.'
          : 'Top plot = place stars (snap to recorded path). Bottom plot = place rocks (free on the wave face).'}
      </div>
    </div>
  );
}

function ToolBtn({
  label, active, onClick, color,
}: { label: string; active: boolean; onClick: () => void; color: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...btn,
        background: active ? color : 'rgba(0,0,0,0.35)',
        color: active ? '#111' : '#fff',
        fontWeight: active ? 700 : 500,
        borderColor: active ? color : 'rgba(255,255,255,0.4)',
      }}
    >
      {label}
    </button>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(8, 12, 20, 0.92)',
  color: '#fff',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  zIndex: 50,
};

const topBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: '0.6rem',
  padding: '0.8rem 1.2rem',
  background: 'rgba(0,0,0,0.4)',
  borderBottom: '1px solid rgba(255,255,255,0.15)',
};

const plotsWrap: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  padding: '0.5rem 1.2rem',
};

const plotContainer: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const plotTitle: React.CSSProperties = {
  fontSize: '0.8rem',
  opacity: 0.85,
  margin: '0 0 0.25rem 0',
};

const svgStyle: React.CSSProperties = {
  width: '100%',
  flex: 1,
  background: 'linear-gradient(180deg, rgba(20,40,80,0.6), rgba(10,20,40,0.6))',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: '6px',
  cursor: 'crosshair',
};

const axisLabelBottom: React.CSSProperties = {
  fontSize: '0.7rem',
  opacity: 0.6,
  textAlign: 'center',
  marginTop: '0.1rem',
};

const btn: React.CSSProperties = {
  padding: '0.45rem 0.8rem',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  fontSize: '0.9rem',
  color: '#fff',
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(255,255,255,0.4)',
  borderRadius: '0.35rem',
  cursor: 'pointer',
};

const primaryBtn: React.CSSProperties = {
  ...btn,
  background: '#43d6ff',
  color: '#0a1622',
  fontWeight: 700,
  borderColor: '#43d6ff',
};

const countPill: React.CSSProperties = {
  padding: '0.4rem 0.7rem',
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: '0.35rem',
  fontSize: '0.85rem',
};

const hint: React.CSSProperties = {
  padding: '0.5rem 1.2rem',
  fontSize: '0.85rem',
  opacity: 0.75,
  borderTop: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(0,0,0,0.3)',
};
