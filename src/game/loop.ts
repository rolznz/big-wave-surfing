import * as THREE from 'three';
import { BaseScene } from './createScene';
import { WaveOcean, waveHeightAt } from './wave';
import {
  WAVE_START_Z,
  BREAK_START_X, BREAK_SPEED, WIPEOUT_GRACE, WIPEOUT_HEIGHT,
  SURFER_START_X, SURFER_START_Z, SURFER_X_LIMIT,
  PADDLE_THRUST, WATER_DRAG, BRAKE_DRAG, TURN_SPEED, WAVE_PUSH_FACTOR,
  FIN_GRIP_BASE, FIN_GRIP_TURNING,
} from './constants';

// ─── Wake trail constants ──────────────────────────────────────────────────────
const TRAIL_DURATION    = 5.0;  // seconds before a slice fades out
const TRAIL_SEGMENTS    = 150;  // max slices kept (covers longest reasonable trail)
const TRAIL_MAX_SPEED   = 15;   // speed (units/s) at which trail reaches full width/brightness
const TRAIL_HALF_WIDTH  = 0.5;  // half-width of ribbon at full speed
const TRAIL_SLICE_DIST  = 0.6;  // emit a new slice every N world units traveled
                                 // (distance-based so a stationary board emits nothing — no pile-up)

interface TrailSlice {
  x: number; z: number;
  perpX: number; perpZ: number;  // unit perp to heading
  halfW: number;
  brightness: number;
  t: number;  // clock.elapsedTime when emitted
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type GamePhase = 'surfing' | 'wiped_out';

export interface GameStatus {
  phase: GamePhase;
  rideTime: number;
  speed: number;       // current speed in units/sec
}

// ─── createLoop ───────────────────────────────────────────────────────────────

export function createLoop(
  bs: BaseScene,
  onStatus: (status: GameStatus) => void,
): () => void {
  const { renderer, scene, camera } = bs;

  // ── Wave ──────────────────────────────────────────────────────────────────
  const wave = new WaveOcean(scene, WAVE_START_Z);

  // ── Surfer (placeholder board) ────────────────────────────────────────────
  const surferGeo = new THREE.BoxGeometry(1.8, 0.2, 0.55);
  const surferMat = new THREE.MeshPhongMaterial({ color: 0xff4500 });
  const surfer = new THREE.Mesh(surferGeo, surferMat);
  surfer.castShadow = true;
  surfer.renderOrder = 2;
  surfer.frustumCulled = false;
  scene.add(surfer);
  surfer.position.set(SURFER_START_X, 0.2, SURFER_START_Z);

  // ── Wake trail ────────────────────────────────────────────────────────────
  // Ribbon mesh: each slice contributes 2 verts (left & right edge).
  // We over-allocate for TRAIL_SEGMENTS+1 slices (max quads = TRAIL_SEGMENTS).
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
    transparent: false,  // keep in opaque queue so renderOrder correctly draws board over trail
  });
  const trailMesh = new THREE.Mesh(trailGeo, trailMat);
  trailMesh.renderOrder = 1;
  trailMesh.frustumCulled = false;
  scene.add(trailMesh);

  const trailSlices: TrailSlice[] = [];
  let lastSliceX = SURFER_START_X;
  let lastSliceZ = SURFER_START_Z;

  // ── State ─────────────────────────────────────────────────────────────────
  let phase: GamePhase = 'surfing';
  let surferX   = SURFER_START_X;
  let surferZ   = SURFER_START_Z;
  let surferVX  = 0;
  let surferVZ  = 0;
  let surferAngle = Math.PI;   // 0 = facing -Z (toward wave); π = facing +Z (toward camera/shore)
  let breakX    = BREAK_START_X;
  let rideTime  = 0;

  const input = { left: false, right: false, up: false, down: false };

  // Camera smooth targets — initialised to match spawn position so there's no pan on start
  const camTarget     = new THREE.Vector3(SURFER_START_X, 5, SURFER_START_Z + 14);
  const camLookTarget = new THREE.Vector3(SURFER_START_X, 1, SURFER_START_Z - 15);
  camera.position.copy(camTarget);
  camera.lookAt(camLookTarget);

  // ── Input ─────────────────────────────────────────────────────────────────
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft'  || e.key === 'a') input.left  = true;
    if (e.key === 'ArrowRight' || e.key === 'd') input.right = true;
    if (e.key === 'ArrowUp'    || e.key === 'w') input.up    = true;
    if (e.key === 'ArrowDown'  || e.key === 's') input.down  = true;
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

  // ── Helpers ───────────────────────────────────────────────────────────────

  function lerpVec3(current: THREE.Vector3, target: THREE.Vector3, alpha: number) {
    current.x += (target.x - current.x) * alpha;
    current.y += (target.y - current.y) * alpha;
    current.z += (target.z - current.z) * alpha;
  }

  const _lookAt   = new THREE.Vector3();
  const _boardMat = new THREE.Matrix4();

  // ── Tick ──────────────────────────────────────────────────────────────────
  const clock = new THREE.Clock();
  let rafId = 0;

  function tick() {
    rafId = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);

    if (phase === 'surfing') {
      rideTime += dt;

      // 1. Rotate heading
      if (input.left)  surferAngle -= TURN_SPEED * dt;
      if (input.right) surferAngle += TURN_SPEED * dt;

      // 2. Forward direction vector (angle=0 → facing -Z)
      const fwdX =  Math.sin(surferAngle);
      const fwdZ = -Math.cos(surferAngle);

      // 3. Paddle thrust in heading direction
      if (input.up) {
        surferVX += fwdX * PADDLE_THRUST * dt;
        surferVZ += fwdZ * PADDLE_THRUST * dt;
      }

      // 4. Wave drive — gravity on slope, projected onto board heading (fin constraint)
      //    The wave surface gradient gives the downslope direction in XZ.
      //    Only the component aligned with the board heading drives the surfer;
      //    the fins resist the perpendicular component.
      //    Wave height at the surfer's position scales the force: more power on
      //    the bigger / steeper part of the wave near the break.
      const eps = 0.5;
      const gradX = (waveHeightAt(surferZ,       wave.waveZ, surferX + eps, breakX)
                   - waveHeightAt(surferZ,       wave.waveZ, surferX - eps, breakX)) / (2 * eps);
      const gradZ = (waveHeightAt(surferZ + eps, wave.waveZ, surferX,       breakX)
                   - waveHeightAt(surferZ - eps, wave.waveZ, surferX,       breakX)) / (2 * eps);

      // Dot product of downslope vector (-grad) with board forward direction.
      // The gradients already shrink as wave amplitude falls off on the shoulders,
      // so slope alone captures the wave's power without double-counting the decay.
      const slopeAlongBoard = -gradX * fwdX - gradZ * fwdZ;

      // Positive = board aimed downhill (drives forward); negative = aimed uphill (brakes)
      const waveDrive = slopeAlongBoard * WAVE_PUSH_FACTOR;
      surferVX += fwdX * waveDrive * dt;
      surferVZ += fwdZ * waveDrive * dt;

      // 5. Fin constraint — bleed off lateral (perpendicular-to-heading) velocity.
      //    Two components:
      //      a) Passive grip (FIN_GRIP_BASE): fins always resist sideways drift,
      //         keeping the board tracking along its heading even when not turning.
      //         Set FIN_GRIP_BASE = 0 to disable.
      //      b) Turn waste (FIN_GRIP_TURNING): extra bleed while actively turning;
      //         a hard snap turn sheds more speed than a gentle carve.
      //         Set FIN_GRIP_TURNING = 0 to disable.
      {
        const vDotFwd = surferVX * fwdX + surferVZ * fwdZ;
        const vLatX   = surferVX - vDotFwd * fwdX;
        const vLatZ   = surferVZ - vDotFwd * fwdZ;
        const latSpeed = Math.hypot(vLatX, vLatZ);
        if (latSpeed > 0) {
          const turning = (input.left || input.right) ? 1 : 0;
          const gripRate = FIN_GRIP_BASE + turning * FIN_GRIP_TURNING;
          const bleed = Math.min(latSpeed, gripRate * dt);
          surferVX -= (vLatX / latSpeed) * bleed;
          surferVZ -= (vLatZ / latSpeed) * bleed;
        }
      }

      // 6. Drag (water resistance, higher when braking)
      const drag = input.down ? WATER_DRAG + BRAKE_DRAG : WATER_DRAG;
      const speed = Math.hypot(surferVX, surferVZ);
      if (speed > 0) {
        const decel = Math.min(speed, drag * dt);
        surferVX -= (surferVX / speed) * decel;
        surferVZ -= (surferVZ / speed) * decel;
      }

      // 7. Integrate position
      surferX += surferVX * dt;
      surferZ += surferVZ * dt;

      // 8. Clamp X to ocean width
      surferX = Math.max(-SURFER_X_LIMIT, Math.min(SURFER_X_LIMIT, surferX));

      // 9. Position: offset along surface normal so board corners stay above surface
      //    even on steep slopes (flat world-Y offset causes corners to dip into the wave).
      {
        const nrmLen = Math.sqrt(gradX*gradX + 1 + gradZ*gradZ);
        const nX = -gradX / nrmLen, nY = 1 / nrmLen, nZ = -gradZ / nrmLen;
        const waveH = waveHeightAt(surferZ, wave.waveZ, surferX, breakX);
        const lift = 0.2; // clearance along surface normal
        surfer.position.set(surferX + nX * lift, waveH + nY * lift, surferZ + nZ * lift);
      }
      const surferY = surfer.position.y; // used for camera target below

      // 10. Board orientation: align with wave surface and heading.
      //     Reuse gradX/gradZ from wave-drive step — same derivatives, no extra samples.
      //     Surface normal: n = normalize(-gradX, 1, -gradZ)
      //     Forward tangent: heading vector lifted onto the surface (t · n = 0 by construction)
      //     Right vector: r = t × n (unit length because t ⊥ n)
      //     Build rotation matrix with columns [fwd, up, right] → extract quaternion.
      {
        const nrmLen = Math.sqrt(gradX*gradX + 1 + gradZ*gradZ);
        const nX = -gradX / nrmLen,  nY = 1 / nrmLen,  nZ = -gradZ / nrmLen;

        const slopeY = gradX * fwdX + gradZ * fwdZ;   // height gained per unit heading travel
        const tLen   = Math.sqrt(fwdX*fwdX + slopeY*slopeY + fwdZ*fwdZ);
        const tX = fwdX / tLen,  tY = slopeY / tLen,  tZ = fwdZ / tLen;

        const rX = tY*nZ - tZ*nY;
        const rY = tZ*nX - tX*nZ;
        const rZ = tX*nY - tY*nX;

        // Row-major: each row is the world-space component of that world axis.
        // Columns are local-X (fwd), local-Y (up), local-Z (right) in world coords.
        _boardMat.set(
          tX, nX, rX, 0,
          tY, nY, rY, 0,
          tZ, nZ, rZ, 0,
          0,  0,  0,  1,
        );
        surfer.quaternion.setFromRotationMatrix(_boardMat);
      }

      // 11. Break front advances left→right, looping when it crosses the ocean
      const breakRange = SURFER_X_LIMIT - BREAK_START_X;
      breakX = BREAK_START_X + (BREAK_SPEED * rideTime) % breakRange;

      // 12. Wave update — mesh follows surfer so ocean never runs out
      wave.update(dt, breakX, surferZ);

      // 13. Wipeout — only when actually on the wave face
      const waveHere = waveHeightAt(surferZ, wave.waveZ, surferX, breakX);
      if (waveHere > WIPEOUT_HEIGHT && breakX > surferX + WIPEOUT_GRACE) {
        phase = 'wiped_out';
      }

      // 14. Wake trail — emit a slice every TRAIL_SLICE_DIST units traveled.
      //     Distance-based emission: stationary board emits nothing, so no additive pile-up.
      const distMoved = Math.hypot(surferX - lastSliceX, surferZ - lastSliceZ);
      if (distMoved >= TRAIL_SLICE_DIST) {
        const spd = Math.hypot(surferVX, surferVZ);
        const t01 = Math.min(1, spd / TRAIL_MAX_SPEED);
        const perpX = -fwdZ;
        const perpZ =  fwdX;
        trailSlices.push({
          x: surferX, z: surferZ,
          perpX, perpZ,
          halfW: t01 * TRAIL_HALF_WIDTH,
          brightness: t01 * 0.7,
          t: clock.elapsedTime,
        });
        if (trailSlices.length > TRAIL_SEGMENTS) trailSlices.shift();
        lastSliceX = surferX;
        lastSliceZ = surferZ;
      }

      // 15. Camera: fixed on shore side (+Z), always looking toward the wave
      camTarget.set(surferX, surferY + 10, surferZ + 24);
      camLookTarget.set(surferX, surferY + 1, surferZ - 15);

    } else {
      // wiped_out: freeze wave, keep camera
      wave.update(0, breakX, surferZ);
    }

    // ── Rebuild wake trail ribbon ──────────────────────────────────────────
    {
      const now2 = clock.elapsedTime;
      // Expire old slices
      while (trailSlices.length > 0 && now2 - trailSlices[0].t > TRAIL_DURATION) {
        trailSlices.shift();
      }

      const n = trailSlices.length;
      for (let i = 0; i < n; i++) {
        const s = trailSlices[i];
        const age = now2 - s.t;
        const fade = Math.max(0, 1 - age / TRAIL_DURATION);
        const b = s.brightness * fade;

        // Re-project onto current wave surface so trail rides the wave
        const currentY = waveHeightAt(s.z, wave.waveZ, s.x, breakX) + 0.08;

        const vi = i * 2;          // left vert index
        const base = vi * 3;

        // left edge
        trailPositions[base    ] = s.x - s.perpX * s.halfW;
        trailPositions[base + 1] = currentY;
        trailPositions[base + 2] = s.z - s.perpZ * s.halfW;
        trailColors[base    ] = b;
        trailColors[base + 1] = b;
        trailColors[base + 2] = b;

        // right edge
        trailPositions[base + 3] = s.x + s.perpX * s.halfW;
        trailPositions[base + 4] = currentY;
        trailPositions[base + 5] = s.z + s.perpZ * s.halfW;
        trailColors[base + 3] = b;
        trailColors[base + 4] = b;
        trailColors[base + 5] = b;
      }

      // Build index buffer for quad strips between consecutive slice pairs
      let idxCount = 0;
      for (let i = 0; i < n - 1; i++) {
        const a = i * 2;       // left of slice i
        const b = a + 1;       // right of slice i
        const c = a + 2;       // left of slice i+1
        const d = a + 3;       // right of slice i+1
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

    // Smooth camera
    const lerpAlpha = 1 - Math.pow(0.01, dt);
    lerpVec3(camera.position, camTarget, lerpAlpha);
    _lookAt.copy(camLookTarget);
    camera.lookAt(_lookAt);

    onStatus({ phase, rideTime, speed: Math.hypot(surferVX, surferVZ) });

    renderer.render(scene, camera);
  }

  tick();

  return function stop() {
    cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('resize', onResize);
    wave.dispose();
    surferGeo.dispose();
    surferMat.dispose();
    trailGeo.dispose();
    trailMat.dispose();
  };
}
