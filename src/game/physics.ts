import * as THREE from 'three';
import { waveHeightAt } from './wave';
import { Character } from './character';
import {
  PRONE_PHYSICS, STANDING_PHYSICS, FLAT_WATER_DRAG,
  BREAK_START_X, SURFER_X_LIMIT, WAVE_SPEED,
  BOARD_LIFT, RAIL_ENGAGEMENT_BASE, RAIL_ENGAGEMENT_GAIN,
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
  s.rideTime += dt;
  s.waveZ += params.waveSpeed * dt;

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
  if (phase === 'wiped_out') return;

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
