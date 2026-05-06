import * as THREE from 'three';
import { Character } from './character';
import { Board } from './board';
import { waveHeightAt } from './wave';
import type { SurferState, PhysicsParams } from './physics';

/**
 * Verlet/PBD ragdoll for wipeouts. The character's joint Groups (built in
 * character.ts) are detached from the rig and reparented flat under a single
 * group beneath the scene root, so each joint's transform can be written
 * independently each frame from particle positions.
 *
 * Bones of the body are the obvious skeleton edges plus a few cross-stays for
 * torso/pelvis stiffness. The board is a 3-particle plate (nose, tail, deck
 * normal) so its orientation is well-defined under tumble.
 */

const GRAVITY = 9.8;
const AIR_DAMPING = 0.6;       // velocity loss per second in air (1/s)
const WATER_DAMPING = 5.0;     // velocity loss per second when submerged
const CONSTRAINT_ITERS = 6;
const HARD_FLOOR = -8;
const WATER_DRAG_TANGENTIAL = 0.7;
const WAVE_DRIFT_FACTOR = 0.7; // submerged particles get carried along by wave

// Capsule end offsets (joint local -Y) — see character.ts buildSkeleton.
const FOREARM_END = -(0.22 + 2 * 0.055); // -0.33
const LOWERLEG_END = -(0.30 + 2 * 0.07); // -0.44

// Particle indices.
const P_PELVIS = 0;
const P_TORSO = 1;
const P_HEAD = 2;
const P_SHOULDER_L = 3;
const P_ELBOW_L = 4;
const P_HAND_L = 5;
const P_SHOULDER_R = 6;
const P_ELBOW_R = 7;
const P_HAND_R = 8;
const P_HIP_L = 9;
const P_KNEE_L = 10;
const P_FOOT_L = 11;
const P_HIP_R = 12;
const P_KNEE_R = 13;
const P_FOOT_R = 14;
const P_BOARD_A = 15; // nose
const P_BOARD_B = 16; // tail
const P_BOARD_N = 17; // deck-normal anchor (above midpoint)
const PARTICLE_COUNT = 18;

interface Bone {
  a: number;
  b: number;
  rest: number;
}

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _Y = new THREE.Vector3(0, 1, 0);
const _NEG_Y = new THREE.Vector3(0, -1, 0);

export class Ragdoll {
  active = false;

  private readonly scene: THREE.Scene;
  private readonly character: Character;
  private readonly board: Board;

  // Flat container — joint Groups become direct children at activation so each
  // joint can be positioned/oriented independently in world space.
  private readonly group: THREE.Group;

  // Particle state (flat arrays for cheap iteration).
  private readonly px = new Float32Array(PARTICLE_COUNT);
  private readonly py = new Float32Array(PARTICLE_COUNT);
  private readonly pz = new Float32Array(PARTICLE_COUNT);
  private readonly ppx = new Float32Array(PARTICLE_COUNT);
  private readonly ppy = new Float32Array(PARTICLE_COUNT);
  private readonly ppz = new Float32Array(PARTICLE_COUNT);

  private readonly bones: Bone[] = [];

  constructor(scene: THREE.Scene, character: Character, board: Board) {
    this.scene = scene;
    this.character = character;
    this.board = board;
    this.group = new THREE.Group();
  }

  activate(state: SurferState, gradX: number, gradZ: number, _params: PhysicsParams): void {
    if (this.active) return;
    this.active = true;

    const j = this.character.joints;

    // Make sure all matrices are current before we sample world positions.
    this.character.root.updateMatrixWorld(true);
    this.board.root.updateMatrixWorld(true);

    // ── Seed particles from current world transforms ───────────────────────
    const pelvisW = j.pelvis.getWorldPosition(new THREE.Vector3());
    const torsoW = j.torso.getWorldPosition(new THREE.Vector3());
    const shLW = j.shoulderL.getWorldPosition(new THREE.Vector3());
    const elLW = j.elbowL.getWorldPosition(new THREE.Vector3());
    const shRW = j.shoulderR.getWorldPosition(new THREE.Vector3());
    const elRW = j.elbowR.getWorldPosition(new THREE.Vector3());
    const hpLW = j.hipL.getWorldPosition(new THREE.Vector3());
    const knLW = j.kneeL.getWorldPosition(new THREE.Vector3());
    const hpRW = j.hipR.getWorldPosition(new THREE.Vector3());
    const knRW = j.kneeR.getWorldPosition(new THREE.Vector3());

    // Hand / foot endpoints: project from forearm/lower-leg joint along its
    // local -Y to the capsule tip.
    const headW = j.head.getWorldPosition(new THREE.Vector3());
    const haLW = j.elbowL.localToWorld(new THREE.Vector3(0, FOREARM_END, 0));
    const haRW = j.elbowR.localToWorld(new THREE.Vector3(0, FOREARM_END, 0));
    const ftLW = j.kneeL.localToWorld(new THREE.Vector3(0, LOWERLEG_END, 0));
    const ftRW = j.kneeR.localToWorld(new THREE.Vector3(0, LOWERLEG_END, 0));

    // Board nose/tail/deck-normal in world.
    const bAW = this.board.root.localToWorld(new THREE.Vector3(0.9, 0, 0));
    const bBW = this.board.root.localToWorld(new THREE.Vector3(-0.9, 0, 0));
    const bNW = this.board.root.localToWorld(new THREE.Vector3(0, 0.3, 0));

    this.setP(P_PELVIS, pelvisW);
    this.setP(P_TORSO, torsoW);
    this.setP(P_HEAD, headW);
    this.setP(P_SHOULDER_L, shLW);
    this.setP(P_ELBOW_L, elLW);
    this.setP(P_HAND_L, haLW);
    this.setP(P_SHOULDER_R, shRW);
    this.setP(P_ELBOW_R, elRW);
    this.setP(P_HAND_R, haRW);
    this.setP(P_HIP_L, hpLW);
    this.setP(P_KNEE_L, knLW);
    this.setP(P_FOOT_L, ftLW);
    this.setP(P_HIP_R, hpRW);
    this.setP(P_KNEE_R, knRW);
    this.setP(P_FOOT_R, ftRW);
    this.setP(P_BOARD_A, bAW);
    this.setP(P_BOARD_B, bBW);
    this.setP(P_BOARD_N, bNW);

    // ── Build bones (rest length = current distance) ───────────────────────
    this.bones.length = 0;
    const addBone = (a: number, b: number) => {
      const dx = this.px[a] - this.px[b];
      const dy = this.py[a] - this.py[b];
      const dz = this.pz[a] - this.pz[b];
      this.bones.push({ a, b, rest: Math.hypot(dx, dy, dz) });
    };
    // Body skeleton.
    addBone(P_PELVIS, P_TORSO);
    addBone(P_TORSO, P_HEAD);
    addBone(P_TORSO, P_SHOULDER_L);
    addBone(P_SHOULDER_L, P_ELBOW_L);
    addBone(P_ELBOW_L, P_HAND_L);
    addBone(P_TORSO, P_SHOULDER_R);
    addBone(P_SHOULDER_R, P_ELBOW_R);
    addBone(P_ELBOW_R, P_HAND_R);
    addBone(P_PELVIS, P_HIP_L);
    addBone(P_HIP_L, P_KNEE_L);
    addBone(P_KNEE_L, P_FOOT_L);
    addBone(P_PELVIS, P_HIP_R);
    addBone(P_HIP_R, P_KNEE_R);
    addBone(P_KNEE_R, P_FOOT_R);
    // Cross stays for torso/pelvis stiffness.
    addBone(P_PELVIS, P_SHOULDER_L);
    addBone(P_PELVIS, P_SHOULDER_R);
    addBone(P_TORSO, P_HIP_L);
    addBone(P_TORSO, P_HIP_R);
    addBone(P_SHOULDER_L, P_SHOULDER_R);
    addBone(P_HIP_L, P_HIP_R);
    // Board (nose, tail, normal anchor) — stays form a triangle.
    addBone(P_BOARD_A, P_BOARD_B);
    addBone(P_BOARD_A, P_BOARD_N);
    addBone(P_BOARD_B, P_BOARD_N);

    // ── Reparent joints flat under our group ───────────────────────────────
    // Order matters: leaf first so each attach() captures the world transform
    // before its parent is moved.
    this.scene.add(this.group);
    this.group.attach(j.head);
    this.group.attach(j.elbowL);
    this.group.attach(j.elbowR);
    this.group.attach(j.shoulderL);
    this.group.attach(j.shoulderR);
    this.group.attach(j.kneeL);
    this.group.attach(j.kneeR);
    this.group.attach(j.hipL);
    this.group.attach(j.hipR);
    this.group.attach(j.torso);
    this.group.attach(j.pelvis);
    // Board too — fly free of the rig.
    this.group.attach(this.board.root);

    // ── Seed velocities (Verlet uses prev positions) ───────────────────────
    // Inherit horizontal velocity, plus a forward-pitch tumble around the
    // surfer's right axis, plus a small per-particle random kick.
    const fwdX = Math.sin(state.angle);
    const fwdZ = -Math.cos(state.angle);
    const rightX = -fwdZ;
    const rightZ = fwdX;
    const speed = Math.hypot(state.vx, state.vz);
    const tumbleOmega = 4 + Math.min(8, speed * 0.4);

    // Surface normal for a small launch impulse "off the wave face".
    const nLen = Math.sqrt(gradX * gradX + 1 + gradZ * gradZ);
    const nX = -gradX / nLen;
    const nY = 1 / nLen;
    const nZ = -gradZ / nLen;

    const dt0 = 1 / 60;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const dx = this.px[i] - this.px[P_PELVIS];
      const dy = this.py[i] - this.py[P_PELVIS];
      const dz = this.pz[i] - this.pz[P_PELVIS];
      // ω × r around the right axis (right is in xz plane, y component 0).
      const rotVx = rightZ * 0 - 0 * dz;
      const rotVy = 0 * dx - rightX * dz;
      const rotVz = rightX * dy - 0 * dx;
      const vx = state.vx + tumbleOmega * rotVx + nX * 1.5 + (Math.random() - 0.5) * 2.5;
      const vy = tumbleOmega * rotVy + nY * 2.0 + (Math.random() - 0.5) * 1.5;
      const vz = state.vz + tumbleOmega * rotVz + nZ * 1.5 + (Math.random() - 0.5) * 2.5;
      this.ppx[i] = this.px[i] - vx * dt0;
      this.ppy[i] = this.py[i] - vy * dt0;
      this.ppz[i] = this.pz[i] - vz * dt0;
    }

    // Board: extra horizontal kick so it separates from the body.
    const boardKickX = -fwdX * 4 + (Math.random() - 0.5) * 2;
    const boardKickZ = -fwdZ * 4 + (Math.random() - 0.5) * 2;
    for (const idx of [P_BOARD_A, P_BOARD_B, P_BOARD_N]) {
      this.ppx[idx] -= boardKickX * dt0;
      this.ppz[idx] -= boardKickZ * dt0;
      this.ppy[idx] -= 3 * dt0;
    }
  }

  step(dt: number, state: SurferState, params: PhysicsParams): void {
    if (!this.active) return;
    // Clamp dt — the same cap loop.ts uses, but be defensive against pauses.
    const h = Math.min(dt, 0.033);
    const h2 = h * h;

    // ── Verlet integrate with gravity + damping + wave drift ───────────────
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const x = this.px[i];
      const y = this.py[i];
      const z = this.pz[i];

      const waveY = waveHeightAt(z, state.waveZ, x, state.breakX,
        params.peakAmp, params.sigmaFront, params.sigmaBack);
      const submerged = y < waveY + 0.1;
      const damping = submerged ? WATER_DAMPING : AIR_DAMPING;
      const dampMul = Math.max(0, 1 - damping * h);

      // Acceleration = gravity + (when submerged) wave drift in +Z + buoyancy.
      let ay = -GRAVITY;
      let az = 0;
      if (submerged) {
        const driftMix = Math.min(1, (waveY + 0.5 - y) / 1.0);
        az += params.waveSpeed * params.waveSpeedMul * WAVE_DRIFT_FACTOR * driftMix;
        ay += GRAVITY * 1.2 * Math.min(1, (waveY - y) * 0.6);
      }

      // Verlet: x_{n+1} = x_n + (x_n - x_{n-1}) * damp + a*dt^2.
      const dx = (x - this.ppx[i]) * dampMul;
      const dy = (y - this.ppy[i]) * dampMul + ay * h2;
      const dz = (z - this.ppz[i]) * dampMul + az * h2;

      this.ppx[i] = x;
      this.ppy[i] = y;
      this.ppz[i] = z;
      this.px[i] = x + dx;
      this.py[i] = y + dy;
      this.pz[i] = z + dz;
    }

    // ── Constraints (PBD distance) ─────────────────────────────────────────
    for (let iter = 0; iter < CONSTRAINT_ITERS; iter++) {
      for (let bi = 0; bi < this.bones.length; bi++) {
        const b = this.bones[bi];
        const dx = this.px[b.b] - this.px[b.a];
        const dy = this.py[b.b] - this.py[b.a];
        const dz = this.pz[b.b] - this.pz[b.a];
        const d = Math.hypot(dx, dy, dz);
        if (d < 1e-6) continue;
        const diff = (d - b.rest) / d * 0.5;
        const ox = dx * diff;
        const oy = dy * diff;
        const oz = dz * diff;
        this.px[b.a] += ox;
        this.py[b.a] += oy;
        this.pz[b.a] += oz;
        this.px[b.b] -= ox;
        this.py[b.b] -= oy;
        this.pz[b.b] -= oz;
      }
      // Wave / floor collision after each iteration so constraints don't
      // drag particles back through the surface.
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const waveY = waveHeightAt(this.pz[i], state.waveZ, this.px[i], state.breakX,
          params.peakAmp, params.sigmaFront, params.sigmaBack);
        if (this.py[i] < waveY) {
          // Tangential drag: dampen horizontal velocity on impact.
          const vx = this.px[i] - this.ppx[i];
          const vz = this.pz[i] - this.ppz[i];
          this.ppx[i] = this.px[i] - vx * WATER_DRAG_TANGENTIAL;
          this.ppz[i] = this.pz[i] - vz * WATER_DRAG_TANGENTIAL;
          this.py[i] = waveY;
        }
        if (this.py[i] < HARD_FLOOR) this.py[i] = HARD_FLOOR;
      }
    }

    // ── Write transforms back to joint Groups ──────────────────────────────
    this.writeJointTransforms();
    this.writeBoardTransform();
  }

  private writeJointTransforms(): void {
    const j = this.character.joints;

    // Pelvis — full basis from torso (up) and hips (right).
    this.setBasisFrom(j.pelvis, P_PELVIS, P_TORSO, P_HIP_L, P_HIP_R);

    // Torso — full basis from head (up) and shoulders (right).
    this.setBasisFrom(j.torso, P_TORSO, P_HEAD, P_SHOULDER_L, P_SHOULDER_R);

    // Head — align +Y with (head - torso) so the hair points away from neck.
    this.setAxisAlign(j.head, P_HEAD, P_HEAD, P_TORSO, _NEG_Y);

    // Limbs: align local -Y with bone direction (parent → child).
    this.setAxisAlign(j.shoulderL, P_SHOULDER_L, P_SHOULDER_L, P_ELBOW_L, _Y);
    this.setAxisAlign(j.elbowL, P_ELBOW_L, P_ELBOW_L, P_HAND_L, _Y);
    this.setAxisAlign(j.shoulderR, P_SHOULDER_R, P_SHOULDER_R, P_ELBOW_R, _Y);
    this.setAxisAlign(j.elbowR, P_ELBOW_R, P_ELBOW_R, P_HAND_R, _Y);
    this.setAxisAlign(j.hipL, P_HIP_L, P_HIP_L, P_KNEE_L, _Y);
    this.setAxisAlign(j.kneeL, P_KNEE_L, P_KNEE_L, P_FOOT_L, _Y);
    this.setAxisAlign(j.hipR, P_HIP_R, P_HIP_R, P_KNEE_R, _Y);
    this.setAxisAlign(j.kneeR, P_KNEE_R, P_KNEE_R, P_FOOT_R, _Y);
  }

  private writeBoardTransform(): void {
    const ax = this.px[P_BOARD_A], ay = this.py[P_BOARD_A], az = this.pz[P_BOARD_A];
    const bx = this.px[P_BOARD_B], by = this.py[P_BOARD_B], bz = this.pz[P_BOARD_B];
    const nx = this.px[P_BOARD_N], ny = this.py[P_BOARD_N], nz = this.pz[P_BOARD_N];

    // Board local +X = nose direction (a - b), +Y = deck normal (toward N).
    _v0.set(ax - bx, ay - by, az - bz).normalize();              // forward (+X)
    _v1.set(nx - (ax + bx) * 0.5, ny - (ay + by) * 0.5, nz - (az + bz) * 0.5).normalize(); // up (+Y)
    // Re-orthogonalise: right = forward × up, then up = right × forward.
    _v2.crossVectors(_v0, _v1).normalize();                       // right (+Z)
    _v1.crossVectors(_v2, _v0).normalize();                       // up (+Y)

    _basis.makeBasis(_v0, _v1, _v2);
    this.board.root.quaternion.setFromRotationMatrix(_basis);
    this.board.root.position.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
  }

  /** Position joint at particle origin and align local axis with (toIdx - fromIdx). */
  private setAxisAlign(
    joint: THREE.Group,
    originIdx: number,
    fromIdx: number,
    toIdx: number,
    localAxis: THREE.Vector3,
  ): void {
    _v0.set(
      this.px[toIdx] - this.px[fromIdx],
      this.py[toIdx] - this.py[fromIdx],
      this.pz[toIdx] - this.pz[fromIdx],
    );
    const len = _v0.length();
    if (len < 1e-6) return;
    _v0.multiplyScalar(1 / len);
    joint.quaternion.setFromUnitVectors(localAxis, _v0);
    joint.position.set(this.px[originIdx], this.py[originIdx], this.pz[originIdx]);
  }

  /** Set joint orientation from a full basis (origin, up, right from sides). */
  private setBasisFrom(
    joint: THREE.Group,
    originIdx: number,
    upIdx: number,
    sideAIdx: number,
    sideBIdx: number,
  ): void {
    const ox = this.px[originIdx], oy = this.py[originIdx], oz = this.pz[originIdx];
    _v1.set(this.px[upIdx] - ox, this.py[upIdx] - oy, this.pz[upIdx] - oz).normalize();
    _v2.set(
      this.px[sideBIdx] - this.px[sideAIdx],
      this.py[sideBIdx] - this.py[sideAIdx],
      this.pz[sideBIdx] - this.pz[sideAIdx],
    ).normalize();
    // forward = up × right
    _v0.crossVectors(_v1, _v2).normalize();
    // right = forward × up (re-orthogonalise)
    _v2.crossVectors(_v0, _v1).normalize();
    // Pelvis/torso local frame: +X forward, +Y up, +Z right (matches the
    // skeleton built in character.ts where hips/shoulders sit at ±Z).
    _basis.makeBasis(_v0, _v1, _v2);
    joint.quaternion.setFromRotationMatrix(_basis);
    joint.position.set(ox, oy, oz);
  }

  private setP(idx: number, v: THREE.Vector3): void {
    this.px[idx] = v.x;
    this.py[idx] = v.y;
    this.pz[idx] = v.z;
  }

  dispose(): void {
    if (this.active) {
      this.scene.remove(this.group);
    }
  }
}
