import * as THREE from 'three';
import { BaseScene } from './createScene';
import { WaveOcean, waveHeightAt } from './wave';
import {
  WAVE_START_Z,
  BREAK_START_X, BREAK_SPEED, WIPEOUT_GRACE, WIPEOUT_HEIGHT,
  SURFER_START_X, SURFER_START_Z, SURFER_X_LIMIT,
  PADDLE_THRUST, WATER_DRAG, BRAKE_DRAG, TURN_SPEED, WAVE_PUSH_FACTOR,
} from './constants';

// ─── Wake trail constants ──────────────────────────────────────────────────────
const TRAIL_DURATION   = 5.0;   // seconds before a slice fades out
const TRAIL_SEGMENTS   = 120;   // max slices kept
const TRAIL_MAX_SPEED  = 15;    // speed at which trail reaches full width/brightness
const TRAIL_HALF_WIDTH = 2.5;   // half-width of ribbon at full speed

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
    transparent: true,
  });
  const trailMesh = new THREE.Mesh(trailGeo, trailMat);
  trailMesh.renderOrder = 1;
  trailMesh.frustumCulled = false;
  scene.add(trailMesh);

  const trailSlices: TrailSlice[] = [];
  let lastSliceTime = -Infinity;
  const SLICE_INTERVAL = TRAIL_DURATION / TRAIL_SEGMENTS;

  // ── State ─────────────────────────────────────────────────────────────────
  let phase: GamePhase = 'surfing';
  let surferX   = SURFER_START_X;
  let surferZ   = SURFER_START_Z;
  let surferVX  = 0;
  let surferVZ  = 0;
  let surferAngle = 0;   // 0 = facing -Z (toward incoming wave)
  let breakX    = BREAK_START_X;
  let rideTime  = 0;

  const input = { left: false, right: false, up: false, down: false };

  // Camera smooth targets
  const camTarget     = new THREE.Vector3(0, 5, 11);
  const camLookTarget = new THREE.Vector3(0, 1, -5);
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

  const _lookAt = new THREE.Vector3();

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

      // 5. Drag (water resistance, higher when braking)
      const drag = input.down ? WATER_DRAG + BRAKE_DRAG : WATER_DRAG;
      const speed = Math.hypot(surferVX, surferVZ);
      if (speed > 0) {
        const decel = Math.min(speed, drag * dt);
        surferVX -= (surferVX / speed) * decel;
        surferVZ -= (surferVZ / speed) * decel;
      }

      // 6. Integrate position
      surferX += surferVX * dt;
      surferZ += surferVZ * dt;

      // 7. Clamp X to ocean width
      surferX = Math.max(-SURFER_X_LIMIT, Math.min(SURFER_X_LIMIT, surferX));

      // 8. Y from wave surface
      const surferY = waveHeightAt(surferZ, wave.waveZ, surferX, breakX) + 0.2;
      surfer.position.set(surferX, surferY, surferZ);

      // 9. Board orientation: long axis (X) points in heading direction
      const slopeDz = (waveHeightAt(surferZ + 0.4, wave.waveZ, surferX, breakX)
                     - waveHeightAt(surferZ - 0.4, wave.waveZ, surferX, breakX)) / 0.8;
      surfer.rotation.set(-Math.atan2(slopeDz, 1), Math.PI / 2 - surferAngle, 0, 'YXZ');

      // 10. Break front advances left→right, looping when it crosses the ocean
      const breakRange = SURFER_X_LIMIT - BREAK_START_X;
      breakX = BREAK_START_X + (BREAK_SPEED * rideTime) % breakRange;

      // 11. Wave update — mesh follows surfer so ocean never runs out
      wave.update(dt, breakX, surferZ);

      // 12. Wipeout — only when actually on the wave face
      const waveHere = waveHeightAt(surferZ, wave.waveZ, surferX, breakX);
      if (waveHere > WIPEOUT_HEIGHT && breakX > surferX + WIPEOUT_GRACE) {
        phase = 'wiped_out';
      }

      // 13. Wake trail — emit a new slice when enough time has passed
      const now = clock.elapsedTime;
      if (now - lastSliceTime >= SLICE_INTERVAL) {
        const spd = Math.hypot(surferVX, surferVZ);
        const t01 = Math.min(1, spd / TRAIL_MAX_SPEED);
        if (t01 > 0.01) {
          const perpX = -fwdZ;
          const perpZ =  fwdX;
          trailSlices.push({
            x: surferX, z: surferZ,
            perpX, perpZ,
            halfW: t01 * TRAIL_HALF_WIDTH,
            brightness: t01,
            t: now,
          });
          if (trailSlices.length > TRAIL_SEGMENTS) trailSlices.shift();
        }
        lastSliceTime = now;
      }

      // 14. Camera: fixed on shore side (+Z), always looking toward the wave
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
