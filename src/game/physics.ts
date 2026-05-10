import * as THREE from 'three';
import { waveHeightAt } from './wave';
import { Character } from './character';
import {
  PRONE_PHYSICS, STANDING_PHYSICS, FLAT_WATER_DRAG,
  BREAK_START_X, SURFER_X_LIMIT, WAVE_SPEED,
  BOARD_LIFT, RAIL_ENGAGEMENT_BASE, RAIL_ENGAGEMENT_GAIN,
  AIR_LAUNCH_MIN_SPEED, AIR_LAUNCH_MAX_ANGLE_DEG, AIR_LAUNCH_FRONT_OFFSET,
  AIR_LAUNCH_VY_FACTOR, AIR_LAUNCH_VY_MAX, AIR_LAUNCH_PEAK_WINDOW,
  AIR_GRAVITY, AIR_TURN_SPEED, AIR_REDIRECT_RATE, AIR_DRAG,
} from './constants';
import type { GamePhase, Stance } from './loop';

export interface SurferState {
  x: number; z: number;
  vx: number; vz: number;
  angle: number;
  stance: Stance;
  paddleCycleT: number;
  paddleRestBlend: number;
  waveZ: number;
  breakX: number;
  rideTime: number;
  airborne: boolean;
  airY: number;
  airVY: number;
  /**
   * Trailing speed samples (rideTime, speed) inside AIR_LAUNCH_PEAK_WINDOW.
   * Sampled while not airborne; used to size the launch pop from the surfer's
   * recent peak speed rather than their current (potentially decelerated) speed.
   */
  speedHistory: { t: number; s: number }[];
}

export interface PhysicsInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  touchHeadingTarget: number | null;
}

export interface PhysicsParams {
  peakAmp: number;
  waveSpeed: number;
  waveSpeedMul: number;
  breakSpeed: number;
  sigmaFront: number;
  sigmaBack: number;
}

export interface StepResult {
  gradX: number;
  gradZ: number;
  /** True if the touch heading rotation hadn't yet settled this frame. */
  touchTurning: boolean;
}

function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Pure-ish surfer physics step. Mutates `state` in place. Does NOT handle
 * collisions, completion, miss, stats, character poses, or rig transforms.
 *
 * `state.waveZ` and `state.breakX` are advanced internally so ghost replays
 * stay self-contained — the live caller still sees identical results because
 * the live `WaveOcean` advances its own waveZ at the same rate.
 */
export function stepSurfer(
  s: SurferState,
  input: PhysicsInput,
  dt: number,
  params: PhysicsParams,
): StepResult {
  const prevWaveZ = s.waveZ;
  s.rideTime += dt;
  s.waveZ += params.waveSpeed * dt;

  if (s.airborne) {
    // Heading: only keyboard left/right while airborne (touch is for surfing).
    if (input.left)  s.angle -= AIR_TURN_SPEED * dt;
    if (input.right) s.angle += AIR_TURN_SPEED * dt;

    const fwdX =  Math.sin(s.angle);
    const fwdZ = -Math.cos(s.angle);

    // Velocity redirect — preserves speed, rotates the velocity vector toward
    // the heading. This is what makes left/right "steer" the air.
    const speedNow = Math.hypot(s.vx, s.vz);
    if (speedNow > 0) {
      const blend = Math.min(1, AIR_REDIRECT_RATE * dt);
      const tgtX = fwdX * speedNow;
      const tgtZ = fwdZ * speedNow;
      s.vx += (tgtX - s.vx) * blend;
      s.vz += (tgtZ - s.vz) * blend;
    }

    // Mild horizontal drag.
    const speed = Math.hypot(s.vx, s.vz);
    if (speed > 0) {
      const decel = Math.min(speed, AIR_DRAG * dt);
      s.vx -= (s.vx / speed) * decel;
      s.vz -= (s.vz / speed) * decel;
    }

    // Vertical integrate.
    s.airVY -= AIR_GRAVITY * dt;
    s.airY  += s.airVY * dt;

    // Horizontal integrate. While airborne, (vx, vz) hold the surfer's
    // velocity *relative to the wave*. The wave's own forward motion is
    // added back here so the surfer drifts with the wave by default and
    // only changes wave-relative position from their own steering.
    s.x += s.vx * dt;
    s.z += (s.vz + params.waveSpeed) * dt;
    s.x = Math.max(-SURFER_X_LIMIT, Math.min(SURFER_X_LIMIT, s.x));

    // Break front advances even while airborne (matches surfing branch).
    const breakRange = SURFER_X_LIMIT - BREAK_START_X;
    s.breakX = BREAK_START_X + (params.breakSpeed * s.rideTime) % breakRange;

    // Landing check.
    const waveH = waveHeightAt(s.z, s.waveZ, s.x, s.breakX,
      params.peakAmp, params.sigmaFront, params.sigmaBack);
    if (s.airY <= waveH) {
      s.airY = waveH;
      s.airVY = 0;
      s.vz += params.waveSpeed;
      s.airborne = false;
      s.speedHistory.length = 0;
    }

    return { gradX: 0, gradZ: 0, touchTurning: false };
  }

  const prevZ = s.z;
  const P = s.stance === 'prone' ? PRONE_PHYSICS : STANDING_PHYSICS;

  // 1. Rotate heading
  if (input.left)  s.angle -= P.TURN_SPEED * dt;
  if (input.right) s.angle += P.TURN_SPEED * dt;

  let touchTurning = false;
  if (input.touchHeadingTarget !== null) {
    const err = wrapPi(input.touchHeadingTarget - s.angle);
    const step = P.TURN_SPEED * 2.5 * dt;
    if (Math.abs(err) <= step) s.angle = input.touchHeadingTarget;
    else s.angle += Math.sign(err) * step;
    touchTurning = Math.abs(err) > 0.01;
  }

  const fwdX =  Math.sin(s.angle);
  const fwdZ = -Math.cos(s.angle);

  // 2. Paddle thrust
  if (input.up && P.PADDLE_THRUST > 0) {
    s.vx += fwdX * P.PADDLE_THRUST * dt;
    s.vz += fwdZ * P.PADDLE_THRUST * dt;
    s.paddleCycleT += dt;
    s.paddleRestBlend = 0;
  } else if (s.paddleCycleT > 0) {
    s.paddleCycleT += dt;
    s.paddleRestBlend = Math.min(1, s.paddleRestBlend + dt * 1.5);
    if (s.paddleRestBlend >= 1) {
      s.paddleCycleT = 0;
      s.paddleRestBlend = 0;
    }
  }

  // 3. Wave drive
  const eps = 0.5;
  const gradX = (waveHeightAt(s.z,       s.waveZ, s.x + eps, s.breakX, params.peakAmp, params.sigmaFront, params.sigmaBack)
               - waveHeightAt(s.z,       s.waveZ, s.x - eps, s.breakX, params.peakAmp, params.sigmaFront, params.sigmaBack)) / (2 * eps);
  const gradZ = (waveHeightAt(s.z + eps, s.waveZ, s.x,       s.breakX, params.peakAmp, params.sigmaFront, params.sigmaBack)
               - waveHeightAt(s.z - eps, s.waveZ, s.x,       s.breakX, params.peakAmp, params.sigmaFront, params.sigmaBack)) / (2 * eps);

  const WAVE_COUPLE_FULL_AT = 0.25;
  const waveHHere = waveHeightAt(s.z, s.waveZ, s.x, s.breakX, params.peakAmp, params.sigmaFront, params.sigmaBack);
  const waveCouple = params.peakAmp > 0
    ? Math.min(1, (waveHHere / params.peakAmp) / WAVE_COUPLE_FULL_AT)
    : 0;

  const slopeAlongBoard = -gradX * fwdX - gradZ * fwdZ;
  const waveDrive = slopeAlongBoard * P.WAVE_PUSH_FACTOR * params.waveSpeedMul * waveCouple;
  s.vx += fwdX * waveDrive * dt;
  s.vz += fwdZ * waveDrive * dt;

  // Lip carry
  if (!input.down) {
    const ratio = params.peakAmp > 0 ? waveHHere / params.peakAmp : 0;
    const lipCouple = ratio * ratio * ratio;
    const carryAccel = WAVE_SPEED * params.waveSpeedMul * lipCouple;
    s.vz += carryAccel * dt;
  }

  // 4. Fin constraint
  const vDotFwd = s.vx * fwdX + s.vz * fwdZ;
  const vLatX   = s.vx - vDotFwd * fwdX;
  const vLatZ   = s.vz - vDotFwd * fwdZ;
  const latSpeed = Math.hypot(vLatX, vLatZ);
  if (latSpeed > 0) {
    const turning = (input.left || input.right || touchTurning) ? 1 : 0;
    const gripRate = (P.FIN_GRIP_BASE + turning * P.FIN_GRIP_TURNING) * params.waveSpeedMul;
    const bleed = Math.min(latSpeed, gripRate * dt);
    s.vx -= (vLatX / latSpeed) * bleed;
    s.vz -= (vLatZ / latSpeed) * bleed;
  }

  // 5. Drag
  const baseDrag = input.down ? P.WATER_DRAG + P.BRAKE_DRAG : P.WATER_DRAG;
  const drag = baseDrag + FLAT_WATER_DRAG * (1 - waveCouple);
  const speed = Math.hypot(s.vx, s.vz);
  if (speed > 0) {
    const decel = Math.min(speed, drag * dt);
    s.vx -= (s.vx / speed) * decel;
    s.vz -= (s.vz / speed) * decel;
  }

  // 6. Integrate
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  s.x = Math.max(-SURFER_X_LIMIT, Math.min(SURFER_X_LIMIT, s.x));

  // 7. Break front advances
  const breakRange = SURFER_X_LIMIT - BREAK_START_X;
  s.breakX = BREAK_START_X + (params.breakSpeed * s.rideTime) % breakRange;

  // 8. Air launch — standing surfer crossing the lip from front to back at
  //    sufficient speed launches into the air. Height scales with speed.
  // Sample speed for the launch-pop window. Done after this frame's velocity
  // updates and only while grounded — peak resets once the surfer's airborne
  // and the in-flight redirect/drag would otherwise pollute it.
  const speedNow = Math.hypot(s.vx, s.vz);
  s.speedHistory.push({ t: s.rideTime, s: speedNow });
  const cutoff = s.rideTime - AIR_LAUNCH_PEAK_WINDOW;
  while (s.speedHistory.length > 0 && s.speedHistory[0].t < cutoff) {
    s.speedHistory.shift();
  }

  // Launch line sits AIR_LAUNCH_FRONT_OFFSET in front of the crest, so the air
  // pops as the surfer approaches the lip on the upper face — not after
  // they've already gone over the back.
  const prevLaunchLine = prevWaveZ + AIR_LAUNCH_FRONT_OFFSET;
  const currLaunchLine = s.waveZ   + AIR_LAUNCH_FRONT_OFFSET;
  if (s.stance === 'standing' && prevZ >= prevLaunchLine && s.z < currLaunchLine) {
    // Only launch if the board is aimed within AIR_LAUNCH_MAX_ANGLE_DEG of
    // "into the wave" (angle = 0 in our heading convention, i.e. fwd = -Z,
    // toward the crest/lip the surfer is hitting). A near-perpendicular
    // cutback is ~90° off and shouldn't pop an air.
    const angleIntoWave = Math.abs(wrapPi(s.angle));
    const maxAngleIntoWave = AIR_LAUNCH_MAX_ANGLE_DEG * Math.PI / 180;
    if (speedNow >= AIR_LAUNCH_MIN_SPEED && angleIntoWave <= maxAngleIntoWave) {
      // Pop height scales with the peak speed in the trailing window so
      // hitting the wave face (which decelerates the surfer rapidly) still
      // launches them properly.
      let peakSpeed = speedNow;
      for (let i = 0; i < s.speedHistory.length; i++) {
        if (s.speedHistory[i].s > peakSpeed) peakSpeed = s.speedHistory[i].s;
      }
      s.airborne = true;
      s.airY = waveHeightAt(s.z, s.waveZ, s.x, s.breakX,
        params.peakAmp, params.sigmaFront, params.sigmaBack);
      s.airVY = Math.min(AIR_LAUNCH_VY_MAX, peakSpeed * AIR_LAUNCH_VY_FACTOR);
      // Convert vz to the wave's frame (it'll be added back during the
      // airborne integrate). Clamp the wave-relative forward component so
      // the surfer never starts the flight already losing ground to the
      // wave — staying on the wave is the default; falling back has to
      // come from the player actively steering backward in flight.
      s.vz = Math.max(0, s.vz - params.waveSpeed);
    }
  }

  return { gradX, gradZ, touchTurning };
}

// ─── Rig transform ───────────────────────────────────────────────────────────

const _rigMat = new THREE.Matrix4();

/**
 * Position + orient the surfer rig on the wave surface based on `state` and
 * the slope gradients returned by `stepSurfer`.
 */
export function updateRigTransform(
  rig: THREE.Group,
  s: SurferState,
  gradX: number,
  gradZ: number,
  params: PhysicsParams,
): void {
  if (s.airborne) {
    rig.position.set(s.x, s.airY + BOARD_LIFT, s.z);

    // Heading-aligned forward, world-up for up; small pitch from airVY so the
    // nose lifts going up and drops on descent.
    const fwdX =  Math.sin(s.angle);
    const fwdZ = -Math.cos(s.angle);
    const pitch = Math.max(-0.45, Math.min(0.45, s.airVY / AIR_LAUNCH_VY_MAX * 0.45));
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
    // tangent (board +X, the nose) tilted up by `pitch` around the lateral axis.
    const tX = fwdX * cosP;
    const tY = sinP;
    const tZ = fwdZ * cosP;
    // up (board +Y) tilted back by the same amount so the basis stays orthonormal.
    const uX = -fwdX * sinP;
    const uY =  cosP;
    const uZ = -fwdZ * sinP;
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
    return;
  }

  const nrmLen = Math.sqrt(gradX * gradX + 1 + gradZ * gradZ);
  const nX = -gradX / nrmLen, nY = 1 / nrmLen, nZ = -gradZ / nrmLen;
  const waveH = waveHeightAt(s.z, s.waveZ, s.x, s.breakX, params.peakAmp, params.sigmaFront, params.sigmaBack);

  rig.position.set(
    s.x + nX * BOARD_LIFT,
    waveH + nY * BOARD_LIFT,
    s.z + nZ * BOARD_LIFT,
  );

  const fwdX =  Math.sin(s.angle);
  const fwdZ = -Math.cos(s.angle);
  const slopeY = gradX * fwdX + gradZ * fwdZ;
  const tLen   = Math.sqrt(fwdX * fwdX + slopeY * slopeY + fwdZ * fwdZ);
  const tX = fwdX / tLen, tY = slopeY / tLen, tZ = fwdZ / tLen;

  let uX = nX, uY = nY, uZ = nZ;
  if (s.stance === 'standing') {
    const vDotFwd = s.vx * fwdX + s.vz * fwdZ;
    const vLatX = s.vx - vDotFwd * fwdX;
    const vLatZ = s.vz - vDotFwd * fwdZ;
    const right = vLatX * (-fwdZ) + vLatZ * fwdX;
    const absLean = Math.min(1, Math.abs(right) / 8);
    const e = RAIL_ENGAGEMENT_BASE + RAIL_ENGAGEMENT_GAIN * absLean;

    const upDotT = tY;
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

// ─── Character pose ─────────────────────────────────────────────────────────

const PADDLE_OMEGA = 7.5;

/**
 * Drive the character pose from `state` + `input` for the current frame.
 * `phase` short-circuits the wiped-out limp pose (already set by caller).
 */
export function updateCharacterPose(
  character: Character,
  s: SurferState,
  input: PhysicsInput,
  dt: number,
  phase: GamePhase,
): void {
  if (phase === 'wiped_out' || phase === 'missed_wave') return;

  if (s.airborne) {
    character.blendTo('standing_neutral', 5, dt);
    return;
  }

  if (s.stance === 'prone') {
    character.blendTo(input.up ? 'prone_paddle_l' : 'prone_neutral', 2, dt);
    if (s.paddleCycleT > 0) {
      const strokePhase = Math.PI - s.paddleCycleT * PADDLE_OMEGA;
      character.setPaddleStroke(strokePhase, s.paddleRestBlend);
    }
  } else {
    const fwdX =  Math.sin(s.angle);
    const fwdZ = -Math.cos(s.angle);
    const vDotFwd = s.vx * fwdX + s.vz * fwdZ;
    const vLatX = s.vx - vDotFwd * fwdX;
    const vLatZ = s.vz - vDotFwd * fwdZ;
    const right = vLatX * (-fwdZ) + vLatZ * fwdX;

    const lean = Math.max(-1, Math.min(1, right / 8));
    if (lean < -0.25) character.blendTo('standing_carve_l', 5, dt);
    else if (lean > 0.25) character.blendTo('standing_carve_r', 5, dt);
    else character.blendTo('standing_neutral', 5, dt);
  }
}
