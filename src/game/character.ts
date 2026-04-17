import * as THREE from 'three';

/**
 * Procedural human character built from capsule/box primitives.
 *
 * Coordinate convention (character local frame):
 *   +X = forward (the way the character is facing)
 *   +Y = up
 *   +Z = right
 *
 * This matches the board/rig frame, so when the character is standing upright
 * on the board the root rotation is identity. To go prone we rotate the root
 * so +Y (head) points forward (+X) — see POSES.prone_neutral below.
 */

export interface CharacterMaterials {
  skin: THREE.MeshPhongMaterial;
  suit: THREE.MeshPhongMaterial;
  hair: THREE.MeshPhongMaterial;
}

export function defaultMaterials(): CharacterMaterials {
  return {
    skin: new THREE.MeshPhongMaterial({ color: 0xe6bfa1 }),
    suit: new THREE.MeshPhongMaterial({ color: 0x1a1a26 }),
    hair: new THREE.MeshPhongMaterial({ color: 0x2a1a10 }),
  };
}

export type PoseName =
  | 'standing_neutral'
  | 'standing_carve_l'
  | 'standing_carve_r'
  | 'prone_neutral'
  | 'prone_paddle_l'
  | 'prone_paddle_r'
  | 'wipeout_limp';

type Euler3 = [number, number, number];

interface Pose {
  /** Root orientation in rig space (XYZ Euler radians). */
  rootRot: Euler3;
  /** Root offset in rig space. */
  rootPos: Euler3;
  /** Local Euler rotation per joint. Any joint not listed defaults to zero. */
  joints: { [jointName: string]: Euler3 };
}

// ─── Poses ───────────────────────────────────────────────────────────────────
// Authored once, blended into at runtime. Limb offsets assume the skeleton
// built below (see `buildSkeleton`). All angles in radians.
//
// Keep these readable: one line per joint where possible.

// Axis conventions in character-local space (+X forward, +Y up, +Z right):
//   joint.rotation.x = ROLL   (lean left/right; positive = right)
//   joint.rotation.y = YAW    (turn head/hips; positive = toward -X... use three.js signs)
//   joint.rotation.z = PITCH  (lean forward/back; negative = forward)
// For limbs hanging along -Y, rotating the root joint around X swings the limb
// sideways, around Z swings it forward/back.

const POSES: { [K in PoseName]: Pose } = {
  standing_neutral: {
    rootRot: [0, 0, 0],
    rootPos: [-0.1, 0.12, 0],
    joints: {
      torso:  [0, 0, -0.15],   // slight forward lean
      head:   [0, 0, 0.12],    // counter-tilt to look ahead
      shoulderL: [-0.5, 0, -0.2], // arms slightly out for balance
      shoulderR: [ 0.5, 0, -0.2],
      elbowL: [0, 0, -0.5],
      elbowR: [0, 0, -0.5],
      hipL: [0.15, 0, -0.15],     // wide stance, slight forward hip tilt
      hipR: [-0.15, 0, -0.15],
      kneeL: [0, 0, 0.6],         // knee bend forward
      kneeR: [0, 0, 0.6],
    },
  },
  standing_carve_l: {
    rootRot: [-0.35, 0, 0],       // lean left (-X roll)
    rootPos: [-0.1, 0.12, -0.08],
    joints: {
      torso:  [-0.15, 0.15, -0.2],
      head:   [-0.1, 0.25, 0.1],
      shoulderL: [-0.9, 0, -0.1],
      shoulderR: [ 0.3, 0, -0.5],
      elbowL: [0, 0, -0.3],
      elbowR: [0, 0, -0.8],
      hipL: [0.2, 0, -0.2],
      hipR: [-0.1, 0, -0.1],
      kneeL: [0, 0, 0.7],
      kneeR: [0, 0, 0.5],
    },
  },
  standing_carve_r: {
    rootRot: [0.35, 0, 0],
    rootPos: [-0.1, 0.12, 0.08],
    joints: {
      torso:  [0.15, -0.15, -0.2],
      head:   [0.1, -0.25, 0.1],
      shoulderL: [-0.3, 0, -0.5],
      shoulderR: [ 0.9, 0, -0.1],
      elbowL: [0, 0, -0.8],
      elbowR: [0, 0, -0.3],
      hipL: [0.1, 0, -0.1],
      hipR: [-0.2, 0, -0.2],
      kneeL: [0, 0, 0.5],
      kneeR: [0, 0, 0.7],
    },
  },
  prone_neutral: {
    // Rotate root so head (+Y in character frame) points forward (+X in rig frame).
    rootRot: [0, 0, -Math.PI / 2],
    // Pelvis centered on board, belly grazing the deck.
    rootPos: [0, 0.18, 0],
    joints: {
      pelvis: [0, 0, 0],
      torso:  [0, 0, 0.05],
      head:   [0, 0, -0.4],        // head lifted to look forward
      // Shoulder Z = π rotates the arm from "hanging down (char -Y)" to
      // "pointing up (char +Y)", which after the prone root rotation is
      // rig +X (forward) — the Superman/paddle reach position.
      shoulderL: [0, 0, Math.PI],
      shoulderR: [0, 0, Math.PI],
      elbowL: [0, 0, 0],
      elbowR: [0, 0, 0],
      hipL: [0, 0, 0.05],
      hipR: [0, 0, -0.05],
      kneeL: [-0.15, 0, 0],        // legs slightly up behind
      kneeR: [-0.15, 0, 0],
    },
  },
  // prone_paddle_l / prone_paddle_r: kept as neutral-identical placeholders.
  // The actual paddle stroke is driven procedurally via setPaddleStroke() so
  // the arms can rotate a full 360° like a freestyle swim stroke.
  prone_paddle_l: {
    rootRot: [0, 0, -Math.PI / 2],
    rootPos: [0, 0.18, 0],
    joints: {
      shoulderL: [0, 0, Math.PI],
      shoulderR: [0, 0, Math.PI],
      head: [0, 0, -0.4],
      kneeL: [-0.15, 0, 0],
      kneeR: [-0.15, 0, 0],
    },
  },
  prone_paddle_r: {
    rootRot: [0, 0, -Math.PI / 2],
    rootPos: [0, 0.18, 0],
    joints: {
      shoulderL: [0, 0, Math.PI],
      shoulderR: [0, 0, Math.PI],
      head: [0, 0, -0.4],
      kneeL: [-0.15, 0, 0],
      kneeR: [-0.15, 0, 0],
    },
  },
  wipeout_limp: {
    rootRot: [0.6, 0.4, -0.8],
    rootPos: [0, 0.3, 0],
    joints: {
      pelvis: [0.2, 0, 0],
      torso:  [0.3, 0.2, -0.1],
      head:   [-0.5, 0.3, 0.2],
      shoulderL: [0.5, 0.8, -2.2],
      shoulderR: [-0.5, -0.8, 2.0],
      elbowL: [0.6, 1.1, 0],
      elbowR: [-0.4, -1.3, 0],
      hipL: [0.8, 0, 0.3],
      hipR: [-0.5, 0, -0.4],
      kneeL: [1.2, 0, 0],
      kneeR: [0.9, 0, 0],
    },
  },
};

// ─── Skeleton ────────────────────────────────────────────────────────────────

type Joints = {
  pelvis: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  shoulderL: THREE.Group;
  shoulderR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  hipL: THREE.Group;
  hipR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
};

function buildSkeleton(mats: CharacterMaterials): {
  root: THREE.Group;
  joints: Joints;
  meshes: THREE.Mesh[];
} {
  const meshes: THREE.Mesh[] = [];

  // Helpers: each limb "segment" is a mesh living inside a joint group. The
  // mesh is offset down (-Y) by half its length so the joint sits at the
  // anatomically correct pivot (shoulder, hip, elbow, knee).
  function capsule(r: number, len: number, mat: THREE.Material) {
    const g = new THREE.CapsuleGeometry(r, len, 4, 8);
    const m = new THREE.Mesh(g, mat);
    m.position.y = -len / 2 - r;
    m.castShadow = true;
    meshes.push(m);
    return m;
  }
  function box(w: number, h: number, d: number, mat: THREE.Material, yOffset = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.position.y = yOffset;
    m.castShadow = true;
    meshes.push(m);
    return m;
  }

  const root = new THREE.Group();

  // Pelvis — anchor of the skeleton
  const pelvis = new THREE.Group();
  pelvis.add(box(0.28, 0.18, 0.22, mats.suit));
  root.add(pelvis);

  // Torso — sits above pelvis
  const torso = new THREE.Group();
  torso.position.set(0, 0.18, 0);
  torso.add(box(0.38, 0.45, 0.25, mats.suit, 0.22));
  pelvis.add(torso);

  // Head — above torso
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0);
  head.add(box(0.2, 0.22, 0.2, mats.skin));
  head.add(box(0.22, 0.12, 0.22, mats.hair, 0.08));   // hair cap
  torso.add(head);

  // Shoulders → upper arms → elbows → forearms
  function buildArm(side: 1 | -1): { shoulder: THREE.Group; elbow: THREE.Group } {
    const shoulder = new THREE.Group();
    shoulder.position.set(0, 0.38, 0.22 * side);
    shoulder.add(capsule(0.06, 0.22, mats.skin));     // upper arm
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.34, 0);
    elbow.add(capsule(0.055, 0.22, mats.skin));       // forearm
    shoulder.add(elbow);
    torso.add(shoulder);
    return { shoulder, elbow };
  }
  const armL = buildArm(-1);
  const armR = buildArm(1);

  // Hips → upper legs → knees → lower legs
  function buildLeg(side: 1 | -1): { hip: THREE.Group; knee: THREE.Group } {
    const hip = new THREE.Group();
    hip.position.set(0, -0.1, 0.1 * side);
    hip.add(capsule(0.08, 0.3, mats.suit));
    const knee = new THREE.Group();
    knee.position.set(0, -0.46, 0);
    knee.add(capsule(0.07, 0.3, mats.skin));
    hip.add(knee);
    pelvis.add(hip);
    return { hip, knee };
  }
  const legL = buildLeg(-1);
  const legR = buildLeg(1);

  return {
    root,
    joints: {
      pelvis, torso, head,
      shoulderL: armL.shoulder,  elbowL: armL.elbow,
      shoulderR: armR.shoulder,  elbowR: armR.elbow,
      hipL: legL.hip,            kneeL: legL.knee,
      hipR: legR.hip,            kneeR: legR.knee,
    },
    meshes,
  };
}

// ─── Character class ─────────────────────────────────────────────────────────

export class Character {
  readonly root: THREE.Group;
  readonly materials: CharacterMaterials;
  readonly joints: Joints;
  private readonly meshes: THREE.Mesh[];

  /** Currently-applied pose targets (updated by blendTo each frame). */
  private currentPose: PoseName = 'standing_neutral';
  private blendT = 1;             // 0..1 progress from sourcePose to targetPose
  private sourcePose: PoseName = 'standing_neutral';
  private targetPose: PoseName = 'standing_neutral';

  constructor(materials?: CharacterMaterials) {
    this.materials = materials ?? defaultMaterials();
    const sk = buildSkeleton(this.materials);
    this.root = sk.root;
    this.joints = sk.joints;
    this.meshes = sk.meshes;
    this.setPose('standing_neutral');
  }

  /** Snap to a pose immediately. */
  setPose(name: PoseName): void {
    this.sourcePose = name;
    this.targetPose = name;
    this.currentPose = name;
    this.blendT = 1;
    this.applyBlend();
  }

  /**
   * Blend toward a pose. Called each frame; `rate` is per-second blend speed
   * (1 = fully blend in one second). Safe to call every frame with the same
   * target — will settle at the target pose.
   */
  blendTo(name: PoseName, rate: number, dt: number): void {
    if (name !== this.targetPose) {
      // Snapshot current pose into sourcePose by applying the current blend
      // and sampling — but we don't need the precise intermediate; using the
      // target as new source gives an acceptable blend for our use case.
      this.sourcePose = this.currentPose;
      this.targetPose = name;
      this.blendT = 0;
    }
    this.blendT = Math.min(1, this.blendT + rate * dt);
    if (this.blendT >= 1) this.currentPose = this.targetPose;
    this.applyBlend();
  }

  /**
   * Directly blend between two authored poses with a given factor.
   * Useful for cyclic animations (e.g. paddle left↔right) where the source
   * and target are known and alpha is driven by a sine wave.
   */
  blendBetween(a: PoseName, b: PoseName, alpha: number): void {
    this.sourcePose = a;
    this.targetPose = b;
    this.currentPose = alpha < 0.5 ? a : b;
    this.blendT = Math.max(0, Math.min(1, alpha));
    this.applyBlend();
  }

  /**
   * Drive a continuous freestyle paddle stroke. Call every frame while
   * paddling, passing the current stroke phase (radians). Arms windmill
   * around the shoulder Z-axis (which, after the prone root rotation, is
   * the lateral axis) — left and right offset by π for alternation.
   *
   * Must be called AFTER blendTo/setPose, since it overrides specific
   * joint rotations that the pose system writes.
   */
  setPaddleStroke(phase: number): void {
    const phaseL = phase;
    const phaseR = phase + Math.PI;

    // Shoulder windmill: θ=π is reach (arm forward/overhead); decreasing θ
    // drives arm down → back → up → forward, matching a freestyle stroke.
    this.joints.shoulderL.rotation.set(0, 0, phaseL);
    this.joints.shoulderR.rotation.set(0, 0, phaseR);

    // Subtle elbow bend — slight pull-through flex when the arm is in the
    // "underwater" half of the stroke (sin(phase) > 0 in our convention).
    const bendL = Math.max(0, Math.sin(phaseL)) * 0.6;
    const bendR = Math.max(0, Math.sin(phaseR)) * 0.6;
    this.joints.elbowL.rotation.set(0, 0, bendL);
    this.joints.elbowR.rotation.set(0, 0, bendR);

    // Body roll toward the recovery arm (the one out of water), ~±17°.
    const roll = Math.cos(phase) * 0.3;
    this.joints.torso.rotation.y = roll;
    this.joints.head.rotation.y = -roll * 0.4;
  }

  private applyBlend(): void {
    const a = POSES[this.sourcePose];
    const b = POSES[this.targetPose];
    const t = this.blendT;

    // Root rotation (Euler, XYZ order)
    const rr = lerp3(a.rootRot, b.rootRot, t);
    this.root.rotation.set(rr[0], rr[1], rr[2]);

    const rp = lerp3(a.rootPos, b.rootPos, t);
    this.root.position.set(rp[0], rp[1], rp[2]);

    // Joint rotations
    for (const name in this.joints) {
      const j = this.joints[name as keyof Joints];
      const va = a.joints[name] ?? [0, 0, 0];
      const vb = b.joints[name] ?? [0, 0, 0];
      const v = lerp3(va, vb, t);
      j.rotation.set(v[0], v[1], v[2]);
    }
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
    }
    this.materials.skin.dispose();
    this.materials.suit.dispose();
    this.materials.hair.dispose();
  }
}

function lerp3(a: Euler3, b: Euler3, t: number): Euler3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}
