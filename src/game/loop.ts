import * as THREE from 'three';
import { BaseScene } from './createScene';
import { WaveOcean, waveHeightAt } from './wave';
import { Character } from './character';
import { Board } from './board';
import { createSpray } from './spray';
import {
  WAVE_START_Z,
  BREAK_START_X, BREAK_SPEED, WIPEOUT_GRACE, WIPEOUT_HEIGHT,
  SURFER_START_X, SURFER_START_Z, SURFER_X_LIMIT,
  PRONE_PHYSICS, STANDING_PHYSICS, POPUP_MIN_SPEED,
  BOARD_LIFT, TRAIL_LIFT,
  TRAIL_DURATION, TRAIL_SEGMENTS, TRAIL_MAX_SPEED,
  TRAIL_HALF_WIDTH, TRAIL_SLICE_DIST,
  CAMERA_FIXED, CAMERA_CHASE,
} from './constants';

// ─── Types ────────────────────────────────────────────────────────────────────

export type GamePhase  = 'surfing' | 'wiped_out';
export type Stance     = 'prone' | 'standing';
export type CameraMode = 'fixed' | 'chase';

export const CAMERA_MODES: readonly CameraMode[] = ['fixed', 'chase'] as const;

export interface GameStatus {
  phase: GamePhase;
  stance: Stance;
  cameraMode: CameraMode;
  rideTime: number;
  speed: number;
}

export interface LoopHandle {
  stop: () => void;
  cycleCameraMode: () => void;
  toggleWireframe: () => boolean;
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
): LoopHandle {
  const { renderer, scene, camera } = bs;

  // ── World objects ────────────────────────────────────────────────────────
  const wave = new WaveOcean(scene, WAVE_START_Z);
  const spray = createSpray(scene);

  // Rig group = the thing we orient to the wave surface. Character + Board
  // live inside it in their own local frame.
  const rig = new THREE.Group();
  rig.renderOrder = 2;
  scene.add(rig);

  const board = new Board(0xf2efe6);
  rig.add(board.root);

  const character = new Character();
  rig.add(character.root);

  // ── State ─────────────────────────────────────────────────────────────────
  let phase: GamePhase = 'surfing';
  let stance: Stance = 'prone';
  let cameraMode: CameraMode = 'fixed';
  let surferX   = SURFER_START_X;
  let surferZ   = SURFER_START_Z;
  let surferVX  = 0;
  let surferVZ  = 0;
  let surferAngle = Math.PI;
  let breakX    = BREAK_START_X;
  let rideTime  = 0;
  let paddleCycleT = 0;        // seconds of continuous paddling (keeps advancing during wind-down)
  let paddleRestBlend = 0;     // 0 = fully stroking, 1 = fully at rest pose

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
    if (e.key === 'ArrowLeft'  || e.key === 'a') input.left  = true;
    if (e.key === 'ArrowRight' || e.key === 'd') input.right = true;
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
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', onResize);

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
    const P = physics();

    // 1. Rotate heading
    if (input.left)  surferAngle -= P.TURN_SPEED * dt;
    if (input.right) surferAngle += P.TURN_SPEED * dt;

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
    const gradX = (waveHeightAt(surferZ,       wave.waveZ, surferX + eps, breakX)
                 - waveHeightAt(surferZ,       wave.waveZ, surferX - eps, breakX)) / (2 * eps);
    const gradZ = (waveHeightAt(surferZ + eps, wave.waveZ, surferX,       breakX)
                 - waveHeightAt(surferZ - eps, wave.waveZ, surferX,       breakX)) / (2 * eps);

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
      const turning = (input.left || input.right) ? 1 : 0;
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

    // 7. Break front advances
    const breakRange = SURFER_X_LIMIT - BREAK_START_X;
    breakX = BREAK_START_X + (BREAK_SPEED * rideTime) % breakRange;

    // 8. Wipeout check
    const waveHere = waveHeightAt(surferZ, wave.waveZ, surferX, breakX);
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
    const waveH = waveHeightAt(surferZ, wave.waveZ, surferX, breakX);

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

    const rX = tY * nZ - tZ * nY;
    const rY = tZ * nX - tX * nZ;
    const rZ = tX * nY - tY * nX;

    _rigMat.set(
      tX, nX, rX, 0,
      tY, nY, rY, 0,
      tZ, nZ, rZ, 0,
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

      const currentY = waveHeightAt(s.z, wave.waveZ, s.x, breakX) + TRAIL_LIFT;
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
      camTarget.set(
        surferX,
        rigY + CAMERA_FIXED.HEIGHT,
        surferZ + CAMERA_FIXED.DISTANCE,
      );
      camLookTarget.set(
        surferX,
        rigY + CAMERA_FIXED.LOOK_UP,
        surferZ - CAMERA_FIXED.LOOK_AHEAD,
      );
    } else {
      // Chase: rotate with surfer heading so we see what's ahead.
      const fwdX =  Math.sin(surferAngle);
      const fwdZ = -Math.cos(surferAngle);
      const camX = surferX - fwdX * CAMERA_CHASE.DISTANCE;
      const camZ = surferZ - fwdZ * CAMERA_CHASE.DISTANCE;

      // Clamp Y so the camera clears the wave surface at its own XZ and at the
      // midpoint toward the surfer (prevents the crest from occluding the view).
      const waveAtCam = waveHeightAt(camZ, wave.waveZ, camX, breakX);
      const midX = (surferX + camX) * 0.5;
      const midZ = (surferZ + camZ) * 0.5;
      const waveAtMid = waveHeightAt(midZ, wave.waveZ, midX, breakX);
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
      spray.update(dt, breakX, wave.waveZ, surferZ);
      emitTrailSlice(now);
    } else {
      wave.update(0, breakX, surferZ, surferX);
      spray.update(dt, breakX, wave.waveZ, surferZ);
    }

    rebuildTrail(now);
    updateCamera(dt);

    onStatus({ phase, stance, cameraMode, rideTime, speed: Math.hypot(surferVX, surferVZ) });
    renderer.render(scene, camera);
  }

  tick();

  function stop() {
    cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('resize', onResize);
    wave.dispose();
    spray.dispose();
    character.dispose();
    board.dispose();
    trailGeo.dispose();
    trailMat.dispose();
  }

  return { stop, cycleCameraMode, toggleWireframe };
}

