import * as THREE from 'three';
import { BaseScene } from './createScene';
import { WaveOcean, waveHeightAt } from './wave';
import { Character } from './character';
import { Board } from './board';
import {
  WAVE_AMP, WAVE_SPEED, WAVE_START_Z,
  BREAK_START_X, BREAK_SPEED, WIPEOUT_GRACE, WIPEOUT_HEIGHT,
  MISSED_BY,
  SURFER_START_X, SURFER_START_Z, SURFER_X_LIMIT,
  PRONE_PHYSICS, STANDING_PHYSICS, POPUP_MIN_SPEED,
  BOARD_LIFT, TRAIL_LIFT,
  RAIL_ENGAGEMENT_BASE, RAIL_ENGAGEMENT_GAIN,
  TRAIL_DURATION, TRAIL_SEGMENTS, TRAIL_MAX_SPEED,
  TRAIL_HALF_WIDTH, TRAIL_SLICE_DIST,
  CAMERA_FIXED, CAMERA_CHASE,
} from './constants';
import type { LevelConfig } from './levels';
import { levelWaveAmp, levelWaveSpeed, levelBreakSpeed, levelGoalX, levelMinStars } from './levels';
import { mulberry32 } from './rng';
import { createObstacles, type ObstacleSystem } from './obstacles';
import { createStars, type StarSystem } from './stars';
import { createPortals } from './portals';

// ─── Types ────────────────────────────────────────────────────────────────────

export type GamePhase  = 'surfing' | 'wiped_out' | 'missed_wave' | 'completed';
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
  const { renderer, scene, camera } = bs;

  // ── Level-derived params ─────────────────────────────────────────────────
  const rng = mulberry32(level.seed);
  const peakAmp = levelWaveAmp(level, WAVE_AMP);
  const waveSpeed = levelWaveSpeed(level, WAVE_SPEED);
  const breakSpeed = levelBreakSpeed(level, BREAK_SPEED);
  const goalX = levelGoalX(level);
  const starsRequired = levelMinStars(level);

  // ── World objects ────────────────────────────────────────────────────────
  const wave = new WaveOcean(scene, {
    startZ: WAVE_START_Z,
    peakAmp,
    waveSpeed,
    breakSpeed,
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

  const portals = createPortals(scene, rig, {
    spawnX: SURFER_START_X,
    spawnY: 20,
    // Start portal rides the wave frame so it stays reachable as the wave scrolls.
    spawnZOffset: SURFER_START_Z - WAVE_START_Z - 40,
    exitX: goalX - 30,
    exitY: 0,
    exitZOffset: 30,
  });

  // ── State ─────────────────────────────────────────────────────────────────
  let phase: GamePhase = 'surfing';
  let stance: Stance = 'prone';
  let cameraMode: CameraMode = 'fixed';
  let surferX   = SURFER_START_X;
  let surferZ   = SURFER_START_Z;
  if (portals.hasPortals) {
    surferZ -= 40;
  }
  let surferVX  = 0;
  // When arriving via a portal, pop out with forward (+Z) momentum so there's
  // no motionless-on-load moment.
  let surferVZ  = portals.hasPortals ? 15 : 0;
  let surferAngle = Math.PI;
  let breakX    = BREAK_START_X;
  let rideTime  = 0;
  let paddleCycleT = 0;        // seconds of continuous paddling (keeps advancing during wind-down)
  let paddleRestBlend = 0;     // 0 = fully stroking, 1 = fully at rest pose

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

  // Camera smooth targets — rebuilt each frame in updateCamera().
  const camTarget = new THREE.Vector3(
    SURFER_START_X,
    CAMERA_FIXED.HEIGHT,
    SURFER_START_Z + CAMERA_FIXED.DISTANCE,
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

  function emitIndicator(state: TouchIndicatorState | null) {
    opts.onTouchIndicator?.(state);
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
    touchStartAngle = surferAngle;
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
    if (stance === 'prone') {
      // Require minimum speed to stand up — can't pop up from a standstill.
      const speed = Math.hypot(surferVX, surferVZ);
      if (speed < POPUP_MIN_SPEED) return;
      stance = 'standing';
    } else {
      stance = 'prone';
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

  const _lookAt   = new THREE.Vector3();
  const _rigMat = new THREE.Matrix4();

  // Physics profile switch
  function physics() {
    return stance === 'prone' ? PRONE_PHYSICS : STANDING_PHYSICS;
  }

  // ── Update: physics ───────────────────────────────────────────────────────
  function updatePhysics(dt: number): { gradX: number; gradZ: number } {
    rideTime += dt;

    // Auto-stand: once moving fast enough, the surfer pops up automatically.
    if (opts.autoStand.current && phase === 'surfing' && stance === 'prone') {
      if (Math.hypot(surferVX, surferVZ) >= POPUP_MIN_SPEED) {
        stance = 'standing';
      }
    }

    const P = physics();

    // 1. Rotate heading
    if (input.left)  surferAngle -= P.TURN_SPEED * dt;
    if (input.right) surferAngle += P.TURN_SPEED * dt;

    // Touch heading: rotate toward drag-derived target. Touch users aim with
    // their finger and expect snappy response, so we boost above keyboard
    // TURN_SPEED — keyboard taps are discrete (you don't see what you're
    // committing to until you've turned), but a touch drag is continuous and
    // self-correcting, so a faster rate doesn't overshoot in practice.
    let touchTurning = false;
    if (touchHeadingTarget !== null) {
      const err = wrapPi(touchHeadingTarget - surferAngle);
      const step = P.TURN_SPEED * 2.5 * dt;
      if (Math.abs(err) <= step) surferAngle = touchHeadingTarget;
      else surferAngle += Math.sign(err) * step;

      touchTurning = Math.abs(err) > 0.01;

      // Count carve flips while in paddle mode (sign of err crosses 0).
      if (touchMode === 'paddle' && phase === 'surfing') {
        const sign: -1 | 0 | 1 = err > 0.05 ? 1 : err < -0.05 ? -1 : 0;
        if (sign !== 0 && lastTouchTurnSign !== 0 && sign !== lastTouchTurnSign) {
          turns++;
        }
        if (sign !== 0) lastTouchTurnSign = sign;
      }
    }

    const fwdX =  Math.sin(surferAngle);
    const fwdZ = -Math.cos(surferAngle);

    // 2. Paddle thrust (only when prone; standing has PADDLE_THRUST=0)
    if (input.up && P.PADDLE_THRUST > 0) {
      surferVX += fwdX * P.PADDLE_THRUST * dt;
      surferVZ += fwdZ * P.PADDLE_THRUST * dt;
      paddleCycleT += dt;
      paddleRestBlend = 0;
    } else if (paddleCycleT > 0) {
      // Keep the stroke advancing forward while blending arms toward the
      // rest pose — avoids the arms rewinding through the cycle in reverse.
      paddleCycleT += dt;
      paddleRestBlend = Math.min(1, paddleRestBlend + dt * 1.5);  // ~0.67s settle
      if (paddleRestBlend >= 1) {
        paddleCycleT = 0;
        paddleRestBlend = 0;
      }
    }

    // 3. Wave drive — gravity along slope, projected onto heading
    const eps = 0.5;
    const gradX = (waveHeightAt(surferZ,       wave.waveZ, surferX + eps, breakX, peakAmp)
                 - waveHeightAt(surferZ,       wave.waveZ, surferX - eps, breakX, peakAmp)) / (2 * eps);
    const gradZ = (waveHeightAt(surferZ + eps, wave.waveZ, surferX,       breakX, peakAmp)
                 - waveHeightAt(surferZ - eps, wave.waveZ, surferX,       breakX, peakAmp)) / (2 * eps);

    const slopeAlongBoard = -gradX * fwdX - gradZ * fwdZ;
    const waveDrive = slopeAlongBoard * P.WAVE_PUSH_FACTOR;
    surferVX += fwdX * waveDrive * dt;
    surferVZ += fwdZ * waveDrive * dt;

    // 4. Fin constraint — bleed lateral (perpendicular-to-heading) velocity
    const vDotFwd = surferVX * fwdX + surferVZ * fwdZ;
    const vLatX   = surferVX - vDotFwd * fwdX;
    const vLatZ   = surferVZ - vDotFwd * fwdZ;
    const latSpeed = Math.hypot(vLatX, vLatZ);
    if (latSpeed > 0) {
      const turning = (input.left || input.right || touchTurning) ? 1 : 0;
      const gripRate = P.FIN_GRIP_BASE + turning * P.FIN_GRIP_TURNING;
      const bleed = Math.min(latSpeed, gripRate * dt);
      surferVX -= (vLatX / latSpeed) * bleed;
      surferVZ -= (vLatZ / latSpeed) * bleed;
    }

    // 5. Drag
    const drag = input.down ? P.WATER_DRAG + P.BRAKE_DRAG : P.WATER_DRAG;
    const speed = Math.hypot(surferVX, surferVZ);
    if (speed > 0) {
      const decel = Math.min(speed, drag * dt);
      surferVX -= (surferVX / speed) * decel;
      surferVZ -= (surferVZ / speed) * decel;
    }

    // 6. Integrate position
    surferX += surferVX * dt;
    surferZ += surferVZ * dt;
    surferX = Math.max(-SURFER_X_LIMIT, Math.min(SURFER_X_LIMIT, surferX));

    // 6b. Stats
    const speedNow = Math.hypot(surferVX, surferVZ);
    if (speedNow > maxSpeed) maxSpeed = speedNow;
    speedAccum += speedNow;
    speedSamples++;

    // 7. Break front advances
    const breakRange = SURFER_X_LIMIT - BREAK_START_X;
    breakX = BREAK_START_X + (breakSpeed * rideTime) % breakRange;

    // 8. Completion — reached the right-hand goal AND collected enough stars.
    // If stars are still needed, the surfer can keep riding to hunt more;
    // the wave will eventually overtake them if they stall too long.
    if (surferX >= goalX && starSys.collectedCount >= starsRequired) {
      phase = 'completed';
      surferVX = 0;
      surferVZ = 0;
      return { gradX, gradZ };
    }

    // 9. Miss — wave crest has passed the surfer by more than MISSED_BY.
    if (wave.waveZ - surferZ > MISSED_BY) {
      phase = 'missed_wave';
      character.setPose('wipeout_limp');
      return { gradX, gradZ };
    }

    // 10. Obstacle collision → wipeout.
    const surferY = waveHeightAt(surferZ, wave.waveZ, surferX, breakX, peakAmp) + BOARD_LIFT;
    if (obstacleSys.check(surferX, surferY, surferZ, wave.waveZ)) {
      phase = 'wiped_out';
      character.setPose('wipeout_limp');
      return { gradX, gradZ };
    }

    // 10b. Star pickup.
    starSys.tryCollect(surferX, surferY, surferZ, wave.waveZ);

    // 11. Wipeout check (whitewater overtakes surfer)
    const waveHere = waveHeightAt(surferZ, wave.waveZ, surferX, breakX, peakAmp);
    if (waveHere > WIPEOUT_HEIGHT && breakX > surferX + WIPEOUT_GRACE) {
      phase = 'wiped_out';
      character.setPose('wipeout_limp');
    }

    return { gradX, gradZ };
  }

  // ── Update: rig transform (position + orientation on wave) ────────────────
  function updateRigTransform(gradX: number, gradZ: number): void {
    const nrmLen = Math.sqrt(gradX * gradX + 1 + gradZ * gradZ);
    const nX = -gradX / nrmLen, nY = 1 / nrmLen, nZ = -gradZ / nrmLen;
    const waveH = waveHeightAt(surferZ, wave.waveZ, surferX, breakX, peakAmp);

    rig.position.set(
      surferX + nX * BOARD_LIFT,
      waveH + nY * BOARD_LIFT,
      surferZ + nZ * BOARD_LIFT,
    );

    // Orientation: forward tangent along heading, up along surface normal
    const fwdX =  Math.sin(surferAngle);
    const fwdZ = -Math.cos(surferAngle);
    const slopeY = gradX * fwdX + gradZ * fwdZ;
    const tLen   = Math.sqrt(fwdX * fwdX + slopeY * slopeY + fwdZ * fwdZ);
    const tX = fwdX / tLen, tY = slopeY / tLen, tZ = fwdZ / tLen;

    // Rail engagement: reduce the cross-slope roll so the deck sits closer to
    // horizontal than the wave face, as if the fin and downhill rail were
    // gripping the water. Blends the up vector toward world-up projected onto
    // the plane ⊥ to the tangent — keeps pitch exact, only roll changes.
    let uX = nX, uY = nY, uZ = nZ;
    if (stance === 'standing') {
      // Lateral velocity magnitude in the board's right-axis frame (same as
      // the carve-pose selector). right-axis = (fwdZ, -fwdX) in world X/Z.
      const vDotFwd = surferVX * fwdX + surferVZ * fwdZ;
      const vLatX = surferVX - vDotFwd * fwdX;
      const vLatZ = surferVZ - vDotFwd * fwdZ;
      const right = vLatX * (-fwdZ) + vLatZ * fwdX;
      const absLean = Math.min(1, Math.abs(right) / 8);
      const e = RAIL_ENGAGEMENT_BASE + RAIL_ENGAGEMENT_GAIN * absLean;

      // World-up minus its tangent-component → zero-roll up target.
      const upDotT = tY;             // (0,1,0) · (tX,tY,tZ)
      const qX = -upDotT * tX;
      const qY =  1 - upDotT * tY;
      const qZ = -upDotT * tZ;
      const qLen = Math.sqrt(qX * qX + qY * qY + qZ * qZ);
      const uqX = qX / qLen, uqY = qY / qLen, uqZ = qZ / qLen;

      const bX = nX + (uqX - nX) * e;
      const bY = nY + (uqY - nY) * e;
      const bZ = nZ + (uqZ - nZ) * e;
      const bLen = Math.sqrt(bX * bX + bY * bY + bZ * bZ);
      uX = bX / bLen; uY = bY / bLen; uZ = bZ / bLen;
    }

    const rX = tY * uZ - tZ * uY;
    const rY = tZ * uX - tX * uZ;
    const rZ = tX * uY - tY * uX;

    _rigMat.set(
      tX, uX, rX, 0,
      tY, uY, rY, 0,
      tZ, uZ, rZ, 0,
      0,  0,  0,  1,
    );
    rig.quaternion.setFromRotationMatrix(_rigMat);
  }

  // ── Update: character pose from stance + input ────────────────────────────
  // Paddle stroke: ~1.2 strokes/sec per arm → ω ≈ 2π·1.2 ≈ 7.5 rad/s.
  const PADDLE_OMEGA = 7.5;

  function updateCharacterPose(dt: number): void {
    if (phase === 'wiped_out') return;    // already wipeout_limp

    if (stance === 'prone') {
      // Flatten out while actively paddling; settle into cobra/sphinx rest otherwise.
      character.blendTo(input.up ? 'prone_paddle_l' : 'prone_neutral', 2, dt);
      if (paddleCycleT > 0) {
        // θ decreases over time so the arm sweeps reach → pull → recover.
        const strokePhase = Math.PI - paddleCycleT * PADDLE_OMEGA;
        character.setPaddleStroke(strokePhase, paddleRestBlend);
      }
    } else {
      // Standing: choose carve pose from lateral velocity
      const fwdX =  Math.sin(surferAngle);
      const fwdZ = -Math.cos(surferAngle);
      const vDotFwd = surferVX * fwdX + surferVZ * fwdZ;
      const vLatX = surferVX - vDotFwd * fwdX;
      const vLatZ = surferVZ - vDotFwd * fwdZ;
      // Lateral velocity in the board's right-axis frame. right vector = (fwdZ, -fwdX).
      const right = vLatX * (-fwdZ) + vLatZ * fwdX;
      // right > 0 means moving toward board-right → carving right. Use that to pick pose.

      const lean = Math.max(-1, Math.min(1, right / 8));
      if (lean < -0.25) character.blendTo('standing_carve_l', 5, dt);
      else if (lean > 0.25) character.blendTo('standing_carve_r', 5, dt);
      else character.blendTo('standing_neutral', 5, dt);
    }
  }

  // ── Update: wake trail ────────────────────────────────────────────────────
  function emitTrailSlice(now: number): void {
    const distMoved = Math.hypot(surferX - lastSliceX, surferZ - lastSliceZ);
    if (distMoved < TRAIL_SLICE_DIST) return;
    const spd = Math.hypot(surferVX, surferVZ);
    const t01 = Math.min(1, spd / TRAIL_MAX_SPEED);
    const fwdX =  Math.sin(surferAngle);
    const fwdZ = -Math.cos(surferAngle);
    trailSlices.push({
      x: surferX, z: surferZ,
      perpX: -fwdZ, perpZ: fwdX,
      halfW: t01 * TRAIL_HALF_WIDTH,
      brightness: t01 * 0.7,
      t: now,
    });
    if (trailSlices.length > TRAIL_SEGMENTS) trailSlices.shift();
    lastSliceX = surferX;
    lastSliceZ = surferZ;
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

      const currentY = waveHeightAt(s.z, wave.waveZ, s.x, breakX, peakAmp) + TRAIL_LIFT;
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

    if (cameraMode === 'fixed') {
      // World-axis: always look toward -Z regardless of heading.
      const camX = surferX;
      const camZ = surferZ + CAMERA_FIXED.DISTANCE;

      // Clamp Y so the wave crest never occludes the shot when it rolls
      // between camera and surfer (surfer missed the wave / went down the back).
      const waveAtCam = waveHeightAt(camZ, wave.waveZ, camX, breakX, peakAmp);
      const midZ = (surferZ + camZ) * 0.5;
      const waveAtMid = waveHeightAt(midZ, wave.waveZ, camX, breakX, peakAmp);
      const minY = Math.max(waveAtCam, waveAtMid) + CAMERA_FIXED.MIN_CLEARANCE;
      const camY = Math.max(rigY + CAMERA_FIXED.HEIGHT, minY);

      camTarget.set(camX, camY, camZ);
      camLookTarget.set(
        surferX,
        rigY + CAMERA_FIXED.LOOK_UP,
        surferZ - CAMERA_FIXED.LOOK_AHEAD,
      );
    } else {
      // Chase: rotate with surfer heading so we see what's ahead.
      const fwdX =  Math.sin(surferAngle);
      const fwdZ = -Math.cos(surferAngle);
      // Forward bias only engages when riding sideways along the wave (|fwdX|
      // near 1). When facing +Z/-Z the heading-relative DISTANCE already
      // positions the camera clear of the crest, so no extra bias is needed.
      const bias = CAMERA_CHASE.FORWARD_BIAS * Math.abs(fwdX);
      const camX = surferX - fwdX * CAMERA_CHASE.DISTANCE;
      const camZ = surferZ - fwdZ * CAMERA_CHASE.DISTANCE + bias;

      // Clamp Y so the camera clears the wave surface at its own XZ and at the
      // midpoint toward the surfer (prevents the crest from occluding the view).
      const waveAtCam = waveHeightAt(camZ, wave.waveZ, camX, breakX, peakAmp);
      const midX = (surferX + camX) * 0.5;
      const midZ = (surferZ + camZ) * 0.5;
      const waveAtMid = waveHeightAt(midZ, wave.waveZ, midX, breakX, peakAmp);
      const minY = Math.max(waveAtCam, waveAtMid) + CAMERA_CHASE.MIN_CLEARANCE;
      const camY = Math.max(rigY + CAMERA_CHASE.HEIGHT, minY);

      camTarget.set(camX, camY, camZ);
      camLookTarget.set(
        surferX + fwdX * CAMERA_CHASE.LOOK_AHEAD,
        rigY + CAMERA_CHASE.LOOK_UP,
        surferZ + fwdZ * CAMERA_CHASE.LOOK_AHEAD,
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
      const { gradX, gradZ } = updatePhysics(dt);
      updateRigTransform(gradX, gradZ);
      updateCharacterPose(dt);
      wave.update(dt, breakX, surferZ, surferX);
      emitTrailSlice(now);
    } else {
      wave.update(0, breakX, surferZ, surferX);
    }
    const sampleHeight = (x: number, z: number) =>
      waveHeightAt(z, wave.waveZ, x, breakX, peakAmp);
    obstacleSys.update(wave.waveZ, sampleHeight);
    starSys.update(wave.waveZ, sampleHeight, dt);
    portals.update(dt, wave.waveZ, breakX);

    rebuildTrail(now);
    updateCamera(dt);

    const progress = Math.max(
      0,
      Math.min(1, (surferX - SURFER_START_X) / (goalX - SURFER_START_X)),
    );
    const avgSpeed = speedSamples > 0 ? speedAccum / speedSamples : 0;
    onStatus({
      phase,
      stance,
      cameraMode,
      rideTime,
      speed: Math.hypot(surferVX, surferVZ),
      progress,
      goalX,
      starsCollected: starSys.collectedCount,
      starsTotal: starSys.total,
      starsRequired,
      starsMissed: starSys.missedCount(surferX),
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
    wave.dispose();
    character.dispose();
    board.dispose();
    trailGeo.dispose();
    trailMat.dispose();
    obstacleSys.dispose();
    starSys.dispose();
    portals.dispose();
  }

  return { stop, toggleWireframe };
}

