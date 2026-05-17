import * as THREE from 'three';
import { BaseScene } from './createScene';
import { WaveOcean, waveHeightAt, foamMaskAt } from './wave';
import { Character } from './character';
import { Board } from './board';
import {
  WAVE_AMP, WAVE_SPEED, WAVE_START_Z,
  WAVE_SIGMA_FRONT, WAVE_SIGMA_BACK,
  BREAK_START_X, BREAK_SPEED,
  BALANCE_DRAIN_TIME, BALANCE_RECOVER_TIME,
  FOAM_DRAIN_FULL, FOAM_DRAIN_THRESHOLD,
  BALANCE_WOBBLE_FREQ_HZ, BALANCE_PUSH_MAX,
  FOAM_SURFACE_SINK_MAX, FOAM_SINK_TAU,
  MISSED_BY, SHORE_Z_OFFSET,
  SURFER_START_X, SURFER_START_Z,
  POPUP_MIN_SPEED,
  BOARD_LIFT, PRONE_BOARD_LIFT, TRAIL_LIFT,
  TRAIL_DURATION, TRAIL_SEGMENTS, TRAIL_MAX_SPEED,
  TRAIL_HALF_WIDTH, TRAIL_SLICE_DIST,
  CAMERA_FIXED, CAMERA_CHASE, CAMERA_INTRO,
  SCORE_TIME_REF_S,
  NOTIF_AIR_MS, NOTIF_AIR_ROT_MS_BASE, NOTIF_AIR_ROT_MS_PER_STEP,
  NOTIF_SCALE_AIR, NOTIF_SCALE_AIR_ROT_BASE, NOTIF_SCALE_AIR_ROT_STEP,
  NOTIF_STAR_MS, NOTIF_SCALE_STAR,
  TRICK_POINTS_AIR, TRICK_POINTS_AIR_360, TRICK_POINTS_AIR_540,
  TRICK_POINTS_AIR_720, TRICK_POINTS_AIR_STEP_BEYOND_720,
} from './constants';

function airRotationPoints(step: number): number {
  if (step === 2) return TRICK_POINTS_AIR_360;
  if (step === 3) return TRICK_POINTS_AIR_540;
  if (step === 4) return TRICK_POINTS_AIR_720;
  return TRICK_POINTS_AIR_720 + (step - 4) * TRICK_POINTS_AIR_STEP_BEYOND_720;
}
import type { LevelConfig } from './levels';
import { levelWaveAmp, levelWaveSpeed, levelBreakSpeed, levelWaveThickness, levelGoalX, levelMinStars } from './levels';
import { mulberry32 } from './rng';
import { createObstacles, type ObstacleSystem } from './obstacles';
import { createStars, type StarSystem } from './stars';
import {
  SurferState, PhysicsInput, PhysicsParams,
  stepSurfer, updateRigTransform, updateCharacterPose,
} from './physics';
import { ghostStore, GhostFrame } from './ghostStore';
import { createGhostManager } from './ghosts';
import { Ragdoll } from './ragdoll';

// ─── Types ────────────────────────────────────────────────────────────────────

export type GamePhase  = 'surfing' | 'wiped_out' | 'missed_wave' | 'no_stars' | 'completed';
export type Stance     = 'prone' | 'standing';
export type CameraMode = 'fixed' | 'chase';

export const CAMERA_MODES: readonly CameraMode[] = ['fixed', 'chase'] as const;

export interface RunStats {
  maxSpeed: number;   // world units / sec
  avgSpeed: number;   // world units / sec
  turns: number;      // count of steering direction changes
}

export interface GameStatus {
  phase: GamePhase;
  stance: Stance;
  cameraMode: CameraMode;
  rideTime: number;
  speed: number;
  progress: number;   // 0..1 — lateral progress toward goalX
  goalX: number;
  starsCollected: number;
  starsTotal: number;
  starsRequired: number;
  starsMissed: number;   // uncollected stars the surfer has passed in X
  trickScore: number;    // sum of trick points this run
  /** Surfer balance, 0..1. Drains in whitewater; wipeout at 0. */
  balance: number;
  stats: RunStats;
}

export interface LoopHandle {
  stop: () => void;
  toggleWireframe: () => boolean;
}

export interface LoopOptions {
  /** Live-readable flag: when true, surfer auto-pops from prone to standing once fast enough. */
  autoStand: { current: boolean };
  /** Optional: receives joystick-overlay state on touch drag. Called with null on touch end / cancel. */
  onTouchIndicator?: (state: TouchIndicatorState | null) => void;
  /**
   * Optional trick-event sink. Fires for pumps, carves, airs and rotational
   * airs. `points` is 0 for informational notifications. `scale` is a visual
   * size multiplier (1.0 = base): small for PUMP, larger for big airs.
   */
  onTrick?: (text: string, durationMs: number, points: number, scale: number) => void;
}

/**
 * End-of-run score: `trickScore × (starsCollected / starsTotal) × (60 / rideTime)`,
 * rounded. Stars factor is 1 when the level has no stars; rideTime is clamped
 * away from 0.
 */
export function finalScore(
  trickScore: number,
  starsCollected: number,
  starsTotal: number,
  rideTime: number,
): number {
  const starFactor = starsTotal > 0 ? starsCollected / starsTotal : 1;
  const timeFactor = SCORE_TIME_REF_S / Math.max(rideTime, 0.001);
  return Math.round(trickScore * starFactor * timeFactor);
}

export type TouchMode = 'paddle' | 'brake';

export interface TouchIndicatorState {
  /** Touch origin (clientX/Y of the initial touchstart). */
  originX: number;
  originY: number;
  /** Current finger position (clientX/Y). */
  currentX: number;
  currentY: number;
  /** surferAngle captured at touchstart — defines the reference for paddle vs brake mode lock. */
  snapshotHeading: number;
  /** Locked mode for the current drag, or null when inside the deadzone. */
  mode: TouchMode | null;
}

function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

interface TrailSlice {
  x: number; z: number;
  perpX: number; perpZ: number;
  halfW: number;
  brightness: number;
  t: number;
}

// ─── createLoop ───────────────────────────────────────────────────────────────

export function createLoop(
  bs: BaseScene,
  onStatus: (status: GameStatus) => void,
  level: LevelConfig,
  opts: LoopOptions,
): LoopHandle {
  const { renderer, scene, camera, sky, distantLand, shore, birds } = bs;

  // ── Level-derived params ─────────────────────────────────────────────────
  const rng = mulberry32(level.seed);
  const peakAmp = levelWaveAmp(level, WAVE_AMP);
  const waveSpeed = levelWaveSpeed(level, WAVE_SPEED);
  const waveSpeedMul = level.waveSpeedMultiplier ?? 1;
  const breakSpeed = levelBreakSpeed(level, BREAK_SPEED);
  const sigmaFront = levelWaveThickness(level, WAVE_SIGMA_FRONT);
  const sigmaBack = levelWaveThickness(level, WAVE_SIGMA_BACK);
  const goalX = levelGoalX(level);
  const starsRequired = levelMinStars(level);

  const physicsParams: PhysicsParams = {
    peakAmp, waveSpeed, waveSpeedMul, breakSpeed, sigmaFront, sigmaBack,
  };

  // ── World objects ────────────────────────────────────────────────────────
  const wave = new WaveOcean(scene, {
    startZ: WAVE_START_Z,
    peakAmp,
    waveSpeed,
    breakSpeed,
    sigmaFront,
    sigmaBack,
    rng,
  });
  const obstacleSys: ObstacleSystem = createObstacles(scene, level, rng);
  const starSys: StarSystem = createStars(scene, level, rng, obstacleSys.obstacles);

  // Rig group = the thing we orient to the wave surface. Character + Board
  // live inside it in their own local frame.
  const rig = new THREE.Group();
  rig.renderOrder = 2;
  scene.add(rig);

  const board = new Board(0xf2efe6);
  rig.add(board.root);

  const character = new Character();
  rig.add(character.root);

  const ragdoll = new Ragdoll(scene, character, board);

  // ── State ─────────────────────────────────────────────────────────────────
  let phase: GamePhase = 'surfing';
  let cameraMode: CameraMode = 'fixed';

  const state: SurferState = {
    x: SURFER_START_X,
    z: SURFER_START_Z,
    vx: 0,
    vz: 0,
    angle: Math.PI,
    stance: 'prone',
    paddleCycleT: 0,
    paddleRestBlend: 0,
    waveZ: WAVE_START_Z,
    breakX: BREAK_START_X,
    rideTime: 0,
    airborne: false,
    airY: 0,
    airVY: 0,
    speedHistory: [],
    steerDir: 0,
    steerHoldT: 0,
    prevSteerDir: 0,
    prevSteerHoldT: 0,
    carveHoldDir: 0,
    carveHoldT: 0,
    airRotationAccum: 0,
    prevAirAngle: 0,
    balance: 1,
    foamSink: 0,
  };

  // Trick score accumulator. Wraps `opts.onTrick` so the loop owns the running
  // total while the consumer still gets the per-event callback. Passed only
  // to the live stepSurfer — ghosts share physicsParams but step without
  // onTrick so their replayed pumps/carves don't fire live notifications.
  let trickScore = 0;
  function fireTrick(text: string, durationMs: number, points: number, scale: number) {
    trickScore += points;
    opts.onTrick?.(text, durationMs, points, scale);
  }

  // Air-trick deferral: stepSurfer accumulates s.airRotationAccum during the
  // flight, but the AIR / N° AIR notification only fires once we've confirmed
  // the surfer landed AND didn't wipe out on the same tick. See the bottom
  // of updatePhysics().

  // Stats (reset per run).
  let maxSpeed = 0;
  let speedAccum = 0;
  let speedSamples = 0;
  let turns = 0;
  // Track last *active* steering direction (not the per-frame input state).
  // A "turn" is a flip from left→right or right→left input, debounced on
  // keydown events so holding a key doesn't count repeatedly.
  let lastSteer: 'left' | 'right' | null = null;

  const input = { left: false, right: false, up: false, down: false };

  // ── Recording (for ghost playback on subsequent runs) ────────────────────
  const recording: GhostFrame[] = [];

  // ── Ghost manager (replays prior-run recordings for this level) ──────────
  const ghostManager = createGhostManager(scene, level, physicsParams);

  // Camera smooth targets — rebuilt each frame in updateCamera().
  // Intro: scale offsets down at level start and ease back to 1.0 over
  // CAMERA_INTRO.DURATION seconds for a "zoom out" reveal.
  let introT = 0;
  const introScale0 = CAMERA_INTRO.START_SCALE;
  const camTarget = new THREE.Vector3(
    SURFER_START_X,
    CAMERA_FIXED.HEIGHT * introScale0,
    SURFER_START_Z + CAMERA_FIXED.DISTANCE * introScale0,
  );
  const camLookTarget = new THREE.Vector3(
    SURFER_START_X,
    CAMERA_FIXED.LOOK_UP,
    SURFER_START_Z - CAMERA_FIXED.LOOK_AHEAD,
  );
  camera.position.copy(camTarget);
  camera.lookAt(camLookTarget);

  // ── Wake trail ────────────────────────────────────────────────────────────
  const TRAIL_VERTS = (TRAIL_SEGMENTS + 1) * 2;
  const trailPositions = new Float32Array(TRAIL_VERTS * 3);
  const trailColors    = new Float32Array(TRAIL_VERTS * 3);
  const trailIndices   = new Uint16Array(TRAIL_SEGMENTS * 6);

  const trailGeo = new THREE.BufferGeometry();
  const trailPosAttr = new THREE.BufferAttribute(trailPositions, 3);
  const trailColAttr = new THREE.BufferAttribute(trailColors, 3);
  trailPosAttr.setUsage(THREE.DynamicDrawUsage);
  trailColAttr.setUsage(THREE.DynamicDrawUsage);
  trailGeo.setAttribute('position', trailPosAttr);
  trailGeo.setAttribute('color', trailColAttr);
  trailGeo.setIndex(new THREE.BufferAttribute(trailIndices, 1));

  const trailMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: false,
  });
  const trailMesh = new THREE.Mesh(trailGeo, trailMat);
  trailMesh.renderOrder = 1;
  trailMesh.frustumCulled = false;
  scene.add(trailMesh);

  const trailSlices: TrailSlice[] = [];
  let lastSliceX = SURFER_START_X;
  let lastSliceZ = SURFER_START_Z;

  // ── Input ─────────────────────────────────────────────────────────────────
  function onKeyDown(e: KeyboardEvent) {
    if (e.repeat) return;   // don't double-count held keys for turn tracking

    if (e.key === 'ArrowLeft'  || e.key === 'a') {
      input.left = true;
      if (phase === 'surfing') {
        if (lastSteer === 'right') turns++;
        lastSteer = 'left';
      }
    }
    if (e.key === 'ArrowRight' || e.key === 'd') {
      input.right = true;
      if (phase === 'surfing') {
        if (lastSteer === 'left') turns++;
        lastSteer = 'right';
      }
    }
    if (e.key === 'ArrowUp'    || e.key === 'w') input.up    = true;
    if (e.key === 'ArrowDown'  || e.key === 's') input.down  = true;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      toggleStance();
    }
    if (e.key === 'c' || e.key === 'C') cycleCameraMode();
  }
  function onKeyUp(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft'  || e.key === 'a') input.left  = false;
    if (e.key === 'ArrowRight' || e.key === 'd') input.right = false;
    if (e.key === 'ArrowUp'    || e.key === 'w') input.up    = false;
    if (e.key === 'ArrowDown'  || e.key === 's') input.down  = false;
  }
  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ── Touch input ───────────────────────────────────────────────────────────
  // Single-finger drag: the strongest axis from the touch origin maps to one
  // of the four directional inputs (vertical is inverted vs. arrow keys, so
  // pulling the finger down → paddle, like a paddle stroke).
  // Two-finger touch: toggles stance (replaces Space).
  const TOUCH_DEADZONE = 20;
  let touchOriginX = 0;
  let touchOriginY = 0;
  let touchStartAngle = 0;
  let touchActive = false;
  let touchMode: TouchMode | null = null;
  let touchHeadingTarget: number | null = null;
  let lastTouchTurnSign: -1 | 0 | 1 = 0;

  function clearDirectionalInput() {
    input.left = false;
    input.right = false;
    input.up = false;
    input.down = false;
  }

  function emitIndicator(s: TouchIndicatorState | null) {
    opts.onTouchIndicator?.(s);
  }

  function onTouchStart(e: TouchEvent) {
    e.preventDefault();
    if (e.touches.length >= 3) {
      clearDirectionalInput();
      touchActive = false;
      touchMode = null;
      touchHeadingTarget = null;
      lastTouchTurnSign = 0;
      emitIndicator(null);
      cycleCameraMode();
      return;
    }
    if (e.touches.length === 2) {
      clearDirectionalInput();
      touchActive = false;
      touchMode = null;
      touchHeadingTarget = null;
      lastTouchTurnSign = 0;
      emitIndicator(null);
      toggleStance();
      return;
    }
    const t = e.touches[0];
    touchOriginX = t.clientX;
    touchOriginY = t.clientY;
    touchStartAngle = state.angle;
    touchActive = true;
    touchMode = null;
    touchHeadingTarget = null;
    lastTouchTurnSign = 0;
    clearDirectionalInput();
    emitIndicator({
      originX: touchOriginX,
      originY: touchOriginY,
      currentX: touchOriginX,
      currentY: touchOriginY,
      snapshotHeading: touchStartAngle,
      mode: null,
    });
  }

  function onTouchMove(e: TouchEvent) {
    if (!touchActive || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    const rawDx = t.clientX - touchOriginX;
    const rawDy = t.clientY - touchOriginY;
    const len = Math.hypot(rawDx, rawDy);

    if (len < TOUCH_DEADZONE) {
      clearDirectionalInput();
      touchMode = null;
      touchHeadingTarget = null;
      lastTouchTurnSign = 0;
    } else {
      // Drag direction → world heading using same convention as surferAngle
      // (fwd = (sin θ, -cos θ)). Drag straight down (rawDy > 0) → θ = π,
      // matching the initial surferAngle = π.
      const dragAngle = Math.atan2(rawDx, -rawDy);
      if (touchMode === null) {
        const delta = wrapPi(dragAngle - touchStartAngle);
        touchMode = Math.abs(delta) < Math.PI / 2 ? 'paddle' : 'brake';
      }
      touchHeadingTarget = touchMode === 'brake'
        ? wrapPi(dragAngle + Math.PI)
        : dragAngle;
      input.up = touchMode === 'paddle';
      input.down = touchMode === 'brake';
      input.left = false;
      input.right = false;
    }

    emitIndicator({
      originX: touchOriginX,
      originY: touchOriginY,
      currentX: t.clientX,
      currentY: t.clientY,
      snapshotHeading: touchStartAngle,
      mode: touchMode,
    });
  }

  function onTouchEnd(e: TouchEvent) {
    if (e.touches.length === 0) {
      clearDirectionalInput();
      touchActive = false;
      touchMode = null;
      touchHeadingTarget = null;
      lastTouchTurnSign = 0;
      emitIndicator(null);
    }
  }

  const canvasEl = renderer.domElement;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', onResize);
  canvasEl.addEventListener('touchstart', onTouchStart, { passive: false });
  canvasEl.addEventListener('touchmove', onTouchMove, { passive: false });
  canvasEl.addEventListener('touchend', onTouchEnd);
  canvasEl.addEventListener('touchcancel', onTouchEnd);

  function toggleStance(): void {
    if (phase !== 'surfing') return;
    if (state.stance === 'prone') {
      // Require minimum speed to stand up — can't pop up from a standstill.
      const speed = Math.hypot(state.vx, state.vz);
      if (speed < POPUP_MIN_SPEED) return;
      state.stance = 'standing';
    } else {
      state.stance = 'prone';
    }
  }

  function cycleCameraMode(): void {
    const i = CAMERA_MODES.indexOf(cameraMode);
    cameraMode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
  }

  let wireframe = false;
  function toggleWireframe(): boolean {
    wireframe = !wireframe;
    wave.setWireframe(wireframe);
    return wireframe;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function lerpVec3(current: THREE.Vector3, target: THREE.Vector3, alpha: number) {
    current.x += (target.x - current.x) * alpha;
    current.y += (target.y - current.y) * alpha;
    current.z += (target.z - current.z) * alpha;
  }

  const _lookAt = new THREE.Vector3();

  // ── Update: physics wrapper (live side-effects around stepSurfer) ────────
  function buildPhysicsInput(): PhysicsInput {
    return {
      left: input.left,
      right: input.right,
      up: input.up,
      down: input.down,
      touchHeadingTarget,
    };
  }

  function updatePhysics(dt: number): { gradX: number; gradZ: number } {
    // Auto-stand: once moving fast enough, the surfer pops up automatically.
    if (opts.autoStand.current && state.stance === 'prone') {
      if (Math.hypot(state.vx, state.vz) >= POPUP_MIN_SPEED) {
        state.stance = 'standing';
      }
    }

    // Capture pre-step touch err for the carve-flip stat (sign of err is
    // computed against the pre-step heading).
    const preTouchErr = touchHeadingTarget !== null
      ? wrapPi(touchHeadingTarget - state.angle)
      : 0;

    // Snapshot pre-step airborne so we can detect a clean landing this tick.
    const wasAirborne = state.airborne;

    const physInput = buildPhysicsInput();
    const { gradX, gradZ } = stepSurfer(state, physInput, dt, physicsParams, fireTrick);

    // Stats
    const speedNow = Math.hypot(state.vx, state.vz);
    if (speedNow > maxSpeed) maxSpeed = speedNow;
    speedAccum += speedNow;
    speedSamples++;

    // Touch carve-flip count (paddle mode only).
    if (touchHeadingTarget !== null && touchMode === 'paddle') {
      const sign: -1 | 0 | 1 = preTouchErr > 0.05 ? 1 : preTouchErr < -0.05 ? -1 : 0;
      if (sign !== 0 && lastTouchTurnSign !== 0 && sign !== lastTouchTurnSign) {
        turns++;
      }
      if (sign !== 0) lastTouchTurnSign = sign;
    }

    // 8. Reached the right-hand goal — completed if star quota met, otherwise
    //    it's a fail (the player rode the whole wave but didn't pick up enough
    //    stars to clear the level).
    if (state.x >= goalX) {
      phase = starSys.collectedCount >= starsRequired ? 'completed' : 'no_stars';
      state.vx = 0;
      state.vz = 0;
      return { gradX, gradZ };
    }

    // 9. Miss — wave crest has passed the surfer by more than MISSED_BY.
    //    Skipped while airborne: an air puts the surfer behind the crest by
    //    definition, and a brief flight shouldn't end the run.
    if (!state.airborne && state.waveZ - state.z > MISSED_BY) {
      phase = 'missed_wave';
      // Place the rig on the wave once more so the ragdoll can sample joint
      // world positions before we detach it.
      updateRigTransform(rig, state, gradX, gradZ, physicsParams);
      ragdoll.activate(state, gradX, gradZ, physicsParams);
      return { gradX, gradZ };
    }

    // 9b. Shore — surfer has overrun the wave and run aground on the sandy
    //     beach (rendered by shore.ts at waveZ + SHORE_Z_OFFSET).
    if (!state.airborne && state.z > state.waveZ + SHORE_Z_OFFSET) {
      phase = 'wiped_out';
      updateRigTransform(rig, state, gradX, gradZ, physicsParams);
      ragdoll.activate(state, gradX, gradZ, physicsParams);
      return { gradX, gradZ };
    }

    // 10. Obstacle collision → wipeout.
    const waveHHere = waveHeightAt(state.z, state.waveZ, state.x, state.breakX,
      peakAmp, sigmaFront, sigmaBack);
    const groundLift = state.stance === 'prone' ? PRONE_BOARD_LIFT : BOARD_LIFT;

    // Foam mask at the surfer — drives both the balance drain below and the
    // smoothed rig sink. Smoothing prevents a sharp Y snap when crossing the
    // foam boundary.
    const foamAtSurfer = state.airborne ? 0 : Math.min(1, foamMaskAt(
      state.x, state.z, state.waveZ, state.breakX,
      peakAmp, sigmaFront, sigmaBack,
    ));
    const targetSink = foamAtSurfer * FOAM_SURFACE_SINK_MAX;
    const sinkAlpha = 1 - Math.exp(-dt / FOAM_SINK_TAU);
    state.foamSink += (targetSink - state.foamSink) * sinkAlpha;

    const surferY = state.airborne ? state.airY + BOARD_LIFT : waveHHere + groundLift - state.foamSink;
    if (obstacleSys.check(state.x, surferY, state.z, state.waveZ)) {
      phase = 'wiped_out';
      updateRigTransform(rig, state, gradX, gradZ, physicsParams);
      ragdoll.activate(state, gradX, gradZ, physicsParams);
      return { gradX, gradZ };
    }

    // 10b. Star pickup. On a collection, surface a "★ N/M" notification so
    // the player can track progress without needing the top bar.
    if (starSys.tryCollect(state.x, surferY, state.z, state.waveZ)) {
      fireTrick(`★ ${starSys.collectedCount}/${starSys.total}`, NOTIF_STAR_MS, 0, NOTIF_SCALE_STAR);
    }

    // 11. Whitewater balance — drain in foam, recover when clear. Frozen
    //     while airborne so airs that land in foam credit the trick first
    //     and balance starts draining on the ground. Reuses foamAtSurfer
    //     computed above for the sink smoothing.
    if (!state.airborne) {
      const foam = foamAtSurfer;
      if (foam > FOAM_DRAIN_THRESHOLD) {
        const t = Math.min(1, (foam - FOAM_DRAIN_THRESHOLD) / (FOAM_DRAIN_FULL - FOAM_DRAIN_THRESHOLD));
        state.balance -= (t / BALANCE_DRAIN_TIME) * dt;
      } else {
        state.balance = Math.min(1, state.balance + dt / BALANCE_RECOVER_TIME);
      }
      if (state.balance < 0) state.balance = 0;

      // Low-balance lateral push — sways the surfer left/right without the
      // user steering. Amount ramps with (1 - balance)^2 and oscillates at
      // BALANCE_WOBBLE_FREQ_HZ. Applied to world vx so the surfer drifts
      // sideways on the wave when they're about to lose it.
      const instability = (1 - state.balance) * (1 - state.balance);
      if (instability > 0) {
        const phaseT = state.rideTime * BALANCE_WOBBLE_FREQ_HZ * Math.PI * 2;
        state.vx += Math.sin(phaseT) * BALANCE_PUSH_MAX * instability * dt;
      }
    }

    // 12. Deferred air trick — surfer just landed and survived all checks.
    // Total rotation steps = |accumulated angle| / 180°.
    if (wasAirborne && !state.airborne) {
      const steps = Math.floor(Math.abs(state.airRotationAccum) / Math.PI);
      if (steps >= 2) {
        const degrees = steps * 180;
        const dur   = NOTIF_AIR_ROT_MS_BASE + (steps - 2) * NOTIF_AIR_ROT_MS_PER_STEP;
        const scale = NOTIF_SCALE_AIR_ROT_BASE + (steps - 2) * NOTIF_SCALE_AIR_ROT_STEP;
        fireTrick(`${degrees} AIR!`, dur, airRotationPoints(steps), scale);
      } else {
        fireTrick('AIR!', NOTIF_AIR_MS, TRICK_POINTS_AIR, NOTIF_SCALE_AIR);
      }
    }

    return { gradX, gradZ };
  }

  // ── Update: wake trail ────────────────────────────────────────────────────
  function emitTrailSlice(now: number): void {
    const distMoved = Math.hypot(state.x - lastSliceX, state.z - lastSliceZ);
    if (distMoved < TRAIL_SLICE_DIST) return;
    const spd = Math.hypot(state.vx, state.vz);
    const t01 = Math.min(1, spd / TRAIL_MAX_SPEED);
    const fwdX =  Math.sin(state.angle);
    const fwdZ = -Math.cos(state.angle);
    trailSlices.push({
      x: state.x, z: state.z,
      perpX: -fwdZ, perpZ: fwdX,
      halfW: t01 * TRAIL_HALF_WIDTH,
      brightness: t01 * 0.7,
      t: now,
    });
    if (trailSlices.length > TRAIL_SEGMENTS) trailSlices.shift();
    lastSliceX = state.x;
    lastSliceZ = state.z;
  }

  function rebuildTrail(now: number): void {
    while (trailSlices.length > 0 && now - trailSlices[0].t > TRAIL_DURATION) {
      trailSlices.shift();
    }
    const n = trailSlices.length;
    for (let i = 0; i < n; i++) {
      const s = trailSlices[i];
      const age = now - s.t;
      const fade = Math.max(0, 1 - age / TRAIL_DURATION);
      const b = s.brightness * fade;

      const currentY = waveHeightAt(s.z, state.waveZ, s.x, state.breakX,
        peakAmp, sigmaFront, sigmaBack) + TRAIL_LIFT;
      const base = i * 2 * 3;

      trailPositions[base    ] = s.x - s.perpX * s.halfW;
      trailPositions[base + 1] = currentY;
      trailPositions[base + 2] = s.z - s.perpZ * s.halfW;
      trailColors[base    ] = b;
      trailColors[base + 1] = b;
      trailColors[base + 2] = b;

      trailPositions[base + 3] = s.x + s.perpX * s.halfW;
      trailPositions[base + 4] = currentY;
      trailPositions[base + 5] = s.z + s.perpZ * s.halfW;
      trailColors[base + 3] = b;
      trailColors[base + 4] = b;
      trailColors[base + 5] = b;
    }

    let idxCount = 0;
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      trailIndices[idxCount++] = a;
      trailIndices[idxCount++] = b;
      trailIndices[idxCount++] = c;
      trailIndices[idxCount++] = b;
      trailIndices[idxCount++] = d;
      trailIndices[idxCount++] = c;
    }

    trailPosAttr.needsUpdate = true;
    trailColAttr.needsUpdate = true;
    trailGeo.setDrawRange(0, idxCount);
    (trailGeo.index as THREE.BufferAttribute).needsUpdate = true;
  }

  // ── Update: camera ────────────────────────────────────────────────────────
  function updateCamera(dt: number): void {
    const rigY = rig.position.y;

    introT = Math.min(introT + dt, CAMERA_INTRO.DURATION);
    const introU = introT / CAMERA_INTRO.DURATION;
    // easeOutCubic — quick reveal at first, settles into normal framing.
    const introEase = 1 - Math.pow(1 - introU, 3);
    const introScale = CAMERA_INTRO.START_SCALE
      + (1 - CAMERA_INTRO.START_SCALE) * introEase;

    if (cameraMode === 'fixed') {
      // World-axis: always look toward -Z regardless of heading.
      const camX = state.x;
      const camZ = state.z + CAMERA_FIXED.DISTANCE * introScale;

      // Clamp Y so the wave crest never occludes the shot when it rolls
      // between camera and surfer (surfer missed the wave / went down the back).
      const waveAtCam = waveHeightAt(camZ, state.waveZ, camX, state.breakX,
        peakAmp, sigmaFront, sigmaBack);
      const midZ = (state.z + camZ) * 0.5;
      const waveAtMid = waveHeightAt(midZ, state.waveZ, camX, state.breakX,
        peakAmp, sigmaFront, sigmaBack);
      const minY = Math.max(waveAtCam, waveAtMid) + CAMERA_FIXED.MIN_CLEARANCE;
      const camY = Math.max(rigY + CAMERA_FIXED.HEIGHT * introScale, minY);

      camTarget.set(camX, camY, camZ);
      camLookTarget.set(
        state.x,
        rigY + CAMERA_FIXED.LOOK_UP,
        state.z - CAMERA_FIXED.LOOK_AHEAD,
      );
    } else {
      // Chase: rotate with surfer heading so we see what's ahead.
      const fwdX =  Math.sin(state.angle);
      const fwdZ = -Math.cos(state.angle);
      // Forward bias only engages when riding sideways along the wave (|fwdX|
      // near 1). When facing +Z/-Z the heading-relative DISTANCE already
      // positions the camera clear of the crest, so no extra bias is needed.
      const bias = CAMERA_CHASE.FORWARD_BIAS * Math.abs(fwdX) * introScale;
      const camX = state.x - fwdX * CAMERA_CHASE.DISTANCE * introScale;
      const camZ = state.z - fwdZ * CAMERA_CHASE.DISTANCE * introScale + bias;

      // Clamp Y so the camera clears the wave surface at its own XZ and at the
      // midpoint toward the surfer (prevents the crest from occluding the view).
      const waveAtCam = waveHeightAt(camZ, state.waveZ, camX, state.breakX,
        peakAmp, sigmaFront, sigmaBack);
      const midX = (state.x + camX) * 0.5;
      const midZ = (state.z + camZ) * 0.5;
      const waveAtMid = waveHeightAt(midZ, state.waveZ, midX, state.breakX,
        peakAmp, sigmaFront, sigmaBack);
      const minY = Math.max(waveAtCam, waveAtMid) + CAMERA_CHASE.MIN_CLEARANCE;
      const camY = Math.max(rigY + CAMERA_CHASE.HEIGHT * introScale, minY);

      camTarget.set(camX, camY, camZ);
      camLookTarget.set(
        state.x + fwdX * CAMERA_CHASE.LOOK_AHEAD,
        rigY + CAMERA_CHASE.LOOK_UP,
        state.z + fwdZ * CAMERA_CHASE.LOOK_AHEAD,
      );
    }

    const lerpAlpha = 1 - Math.pow(0.01, dt);
    lerpVec3(camera.position, camTarget, lerpAlpha);
    _lookAt.copy(camLookTarget);
    camera.lookAt(_lookAt);
  }

  // ── Tick ──────────────────────────────────────────────────────────────────
  const clock = new THREE.Clock();
  let rafId = 0;

  function tick() {
    rafId = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = clock.elapsedTime;

    if (phase === 'surfing') {
      // Snapshot input/touch state for the recording before physics may
      // mutate things downstream. stance and phase are filled in after
      // updatePhysics so they reflect what the frame actually used / ended in.
      const frame: GhostFrame = {
        dt,
        left: input.left, right: input.right, up: input.up, down: input.down,
        touchHeadingTarget,
        stance: state.stance,
        phase: 'surfing',
      };

      const physInputForPose = buildPhysicsInput();
      const { gradX, gradZ } = updatePhysics(dt);

      frame.stance = state.stance;
      frame.phase = phase;
      recording.push(frame);
      if (phase !== 'surfing') {
        ghostStore.add({ levelId: level.id, frames: recording.slice() });
      }

      updateRigTransform(rig, state, gradX, gradZ, physicsParams);
      updateCharacterPose(character, state, physInputForPose, dt, phase);
      wave.update(dt, state.breakX, state.z, state.x);
      emitTrailSlice(now);
    } else {
      // Wave keeps rolling so the ragdoll has live whitewater to tumble in.
      // Advance state.waveZ at the same rate stepSurfer would, so the wave
      // height field passed to ragdoll.step() stays consistent.
      state.waveZ += physicsParams.waveSpeed * dt;
      ragdoll.step(dt, state, physicsParams);
      wave.update(dt, state.breakX, state.z, state.x);
    }

    const sampleHeight = (x: number, z: number) =>
      waveHeightAt(z, wave.waveZ, x, state.breakX, peakAmp, sigmaFront, sigmaBack);
    obstacleSys.update(wave.waveZ, sampleHeight);
    starSys.update(wave.waveZ, sampleHeight, dt);

    // Ghosts step regardless of live phase — they keep replaying after the
    // live player wipes out so the surrounding scene stays populated.
    ghostManager.step(dt);

    rebuildTrail(now);
    updateCamera(dt);
    sky.update(rig.position, dt);
    distantLand.update(rig.position);
    shore.update(rig.position.x, state.waveZ);
    birds.update(dt, rig.position);

    const progress = Math.max(
      0,
      Math.min(1, (state.x - SURFER_START_X) / (goalX - SURFER_START_X)),
    );
    const avgSpeed = speedSamples > 0 ? speedAccum / speedSamples : 0;
    onStatus({
      phase,
      stance: state.stance,
      cameraMode,
      rideTime: state.rideTime,
      speed: Math.hypot(state.vx, state.vz),
      progress,
      goalX,
      starsCollected: starSys.collectedCount,
      starsTotal: starSys.total,
      starsRequired,
      starsMissed: starSys.missedCount(state.x),
      trickScore,
      balance: state.balance,
      stats: { maxSpeed, avgSpeed, turns },
    });
    renderer.render(scene, camera);
  }

  tick();

  function stop() {
    cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('resize', onResize);
    canvasEl.removeEventListener('touchstart', onTouchStart);
    canvasEl.removeEventListener('touchmove', onTouchMove);
    canvasEl.removeEventListener('touchend', onTouchEnd);
    canvasEl.removeEventListener('touchcancel', onTouchEnd);
    ragdoll.dispose();
    wave.dispose();
    character.dispose();
    board.dispose();
    trailGeo.dispose();
    trailMat.dispose();
    obstacleSys.dispose();
    starSys.dispose();
    ghostManager.dispose();
  }

  return { stop, toggleWireframe };
}
