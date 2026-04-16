import * as THREE from 'three';
import { BaseScene } from './createScene';
import { WaveOcean, waveHeightAt } from './wave';
import {
  WAVE_START_Z, SHORE_Z,
  BREAK_START_X, BREAK_SPEED, WIPEOUT_GRACE,
  SURFER_START_X, SURFER_START_Z, SURFER_RIDE_Z_OFFSET,
  SURFER_LATERAL_SPEED, SURFER_X_MIN, SURFER_X_MAX,
} from './constants';

// ─── Types ────────────────────────────────────────────────────────────────────

export type GamePhase = 'approach' | 'riding' | 'wiped_out' | 'finished';

export interface GameStatus {
  phase: GamePhase;
  timeToWave: number;  // seconds until wave arrives (approach phase)
  rideTime: number;    // seconds spent riding
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

  // ── State ─────────────────────────────────────────────────────────────────
  let phase: GamePhase = 'approach';
  let surferX = SURFER_START_X;
  let breakX = BREAK_START_X;
  let rideTime = 0;

  const input = { left: false, right: false };

  // Camera: smooth target for lerping
  const camTarget = new THREE.Vector3(0, 5, 14);
  const camLookTarget = new THREE.Vector3(0, 2, -30);
  camera.position.copy(camTarget);
  camera.lookAt(camLookTarget);

  // ── Input ─────────────────────────────────────────────────────────────────
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft'  || e.key === 'a') input.left  = true;
    if (e.key === 'ArrowRight' || e.key === 'd') input.right = true;
  }
  function onKeyUp(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft'  || e.key === 'a') input.left  = false;
    if (e.key === 'ArrowRight' || e.key === 'd') input.right = false;
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

  /** Linearly interpolate a Vector3 toward a target in-place. */
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
    const dt = Math.min(clock.getDelta(), 0.05); // cap at 50 ms

    if (phase === 'approach') {
      // Wave advances; surfer bobs gently
      wave.update(dt, BREAK_START_X);

      surfer.position.y = 0.15 + Math.sin(clock.elapsedTime * 1.8) * 0.06;

      // Switch to riding when wave crest arrives at surfer
      if (wave.waveZ >= SURFER_START_Z - SURFER_RIDE_Z_OFFSET) {
        phase = 'riding';
        surferX = SURFER_START_X;
      }

      // Camera: looking out to sea toward the incoming wave
      camTarget.set(0, 5, 14);
      camLookTarget.set(0, 2, Math.min(-5, wave.waveZ - 5));

    } else if (phase === 'riding') {
      rideTime += dt;

      // Advance break front along X
      breakX = BREAK_START_X + BREAK_SPEED * rideTime;

      // Player steers left/right along the wave face
      if (input.left)  surferX -= SURFER_LATERAL_SPEED * dt;
      if (input.right) surferX += SURFER_LATERAL_SPEED * dt;
      surferX = Math.max(SURFER_X_MIN, Math.min(SURFER_X_MAX, surferX));

      wave.update(dt, breakX);

      // Position surfer on the steep face, just ahead of the crest
      const surferZ = wave.waveZ + SURFER_RIDE_Z_OFFSET;
      const surferY = waveHeightAt(surferZ, wave.waveZ) + 0.2;
      surfer.position.set(surferX, surferY, surferZ);

      // Tilt board along wave slope (Z axis)
      const dz = (waveHeightAt(surferZ + 0.4, wave.waveZ) - waveHeightAt(surferZ - 0.4, wave.waveZ)) / 0.8;
      surfer.rotation.x = -Math.atan2(dz, 1);
      // Lean in the direction of lateral movement
      surfer.rotation.z = input.left ? 0.15 : input.right ? -0.15 : 0;

      // Camera: slightly behind-left of surfer, looking along +X (toward clean face)
      camTarget.set(surferX - 9, surferY + 4.5, surferZ + 5);
      camLookTarget.set(surferX + 10, surferY + 1, surferZ);

      // Check wipeout: break front has passed the surfer
      if (breakX > surferX + WIPEOUT_GRACE) {
        phase = 'wiped_out';
      }
      // Check finish: wave reaches shore
      if (wave.waveZ >= SHORE_Z) {
        phase = 'finished';
      }

    } else {
      // wiped_out / finished: freeze wave, keep camera
      wave.update(0, breakX);
    }

    // Smooth camera
    lerpVec3(camera.position, camTarget, 1 - Math.pow(0.01, dt));
    _lookAt.copy(camLookTarget);
    camera.lookAt(_lookAt);

    // Emit status
    const timeToWave = Math.max(0, (SURFER_START_Z - SURFER_RIDE_Z_OFFSET - wave.waveZ) / 10);
    onStatus({ phase, timeToWave, rideTime });

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
  };
}
