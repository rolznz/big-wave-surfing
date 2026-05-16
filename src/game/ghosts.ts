import * as THREE from 'three';
import { Character, CharacterMaterials } from './character';
import { Board } from './board';
import { waveHeightAt } from './wave';
import {
  SurferState, PhysicsParams, PhysicsInput,
  stepSurfer, updateRigTransform, updateCharacterPose,
} from './physics';
import { Ragdoll } from './ragdoll';
import {
  WAVE_START_Z, BREAK_START_X, SURFER_START_X, SURFER_START_Z,
  TRAIL_DURATION, TRAIL_SEGMENTS, TRAIL_MAX_SPEED,
  TRAIL_HALF_WIDTH, TRAIL_SLICE_DIST, TRAIL_LIFT,
} from './constants';
import type { LevelConfig } from './levels';
import { ghostStore, GhostFrame, GhostRecording } from './ghostStore';

const GHOST_OPACITY = 0.35;
const GHOST_TRAIL_BRIGHTNESS = 0.35;   // multiplier on top of TRAIL_MAX_SPEED ramp

function ghostCharacterMaterials(): CharacterMaterials {
  const common = { transparent: true, opacity: GHOST_OPACITY, depthWrite: false };
  return {
    skin: new THREE.MeshPhongMaterial({ color: 0xe6bfa1, ...common }),
    suit: new THREE.MeshPhongMaterial({ color: 0x1a1a26, ...common }),
    hair: new THREE.MeshPhongMaterial({ color: 0x2a1a10, ...common }),
  };
}

interface TrailSlice {
  x: number; z: number;
  perpX: number; perpZ: number;
  halfW: number;
  brightness: number;
  t: number;
}

interface GhostTrail {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  posAttr: THREE.BufferAttribute;
  colAttr: THREE.BufferAttribute;
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint16Array;
  slices: TrailSlice[];
  lastSliceX: number;
  lastSliceZ: number;
}

function createGhostTrail(scene: THREE.Scene, originX: number, originZ: number): GhostTrail {
  const VERTS = (TRAIL_SEGMENTS + 1) * 2;
  const positions = new Float32Array(VERTS * 3);
  const colors    = new Float32Array(VERTS * 3);
  const indices   = new Uint16Array(TRAIL_SEGMENTS * 6);

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  geo.setIndex(new THREE.BufferAttribute(indices, 1));

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 0;       // behind live trail (renderOrder 1)
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    mesh, geo, mat, posAttr, colAttr,
    positions, colors, indices,
    slices: [],
    lastSliceX: originX,
    lastSliceZ: originZ,
  };
}

function emitGhostTrailSlice(
  trail: GhostTrail,
  s: SurferState,
  now: number,
): void {
  const distMoved = Math.hypot(s.x - trail.lastSliceX, s.z - trail.lastSliceZ);
  if (distMoved < TRAIL_SLICE_DIST) return;
  const spd = Math.hypot(s.vx, s.vz);
  const t01 = Math.min(1, spd / TRAIL_MAX_SPEED);
  const fwdX =  Math.sin(s.angle);
  const fwdZ = -Math.cos(s.angle);
  trail.slices.push({
    x: s.x, z: s.z,
    perpX: -fwdZ, perpZ: fwdX,
    halfW: t01 * TRAIL_HALF_WIDTH,
    brightness: t01 * GHOST_TRAIL_BRIGHTNESS,
    t: now,
  });
  if (trail.slices.length > TRAIL_SEGMENTS) trail.slices.shift();
  trail.lastSliceX = s.x;
  trail.lastSliceZ = s.z;
}

function rebuildGhostTrail(
  trail: GhostTrail,
  s: SurferState,
  params: PhysicsParams,
  now: number,
): void {
  while (trail.slices.length > 0 && now - trail.slices[0].t > TRAIL_DURATION) {
    trail.slices.shift();
  }
  const n = trail.slices.length;
  for (let i = 0; i < n; i++) {
    const slice = trail.slices[i];
    const age = now - slice.t;
    const fade = Math.max(0, 1 - age / TRAIL_DURATION);
    const b = slice.brightness * fade;

    const currentY = waveHeightAt(slice.z, s.waveZ, slice.x, s.breakX,
      params.peakAmp, params.sigmaFront, params.sigmaBack) + TRAIL_LIFT;
    const base = i * 2 * 3;

    trail.positions[base    ] = slice.x - slice.perpX * slice.halfW;
    trail.positions[base + 1] = currentY;
    trail.positions[base + 2] = slice.z - slice.perpZ * slice.halfW;
    trail.colors[base    ] = b;
    trail.colors[base + 1] = b;
    trail.colors[base + 2] = b;

    trail.positions[base + 3] = slice.x + slice.perpX * slice.halfW;
    trail.positions[base + 4] = currentY;
    trail.positions[base + 5] = slice.z + slice.perpZ * slice.halfW;
    trail.colors[base + 3] = b;
    trail.colors[base + 4] = b;
    trail.colors[base + 5] = b;
  }

  let idxCount = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    trail.indices[idxCount++] = a;
    trail.indices[idxCount++] = b;
    trail.indices[idxCount++] = c;
    trail.indices[idxCount++] = b;
    trail.indices[idxCount++] = d;
    trail.indices[idxCount++] = c;
  }

  trail.posAttr.needsUpdate = true;
  trail.colAttr.needsUpdate = true;
  trail.geo.setDrawRange(0, idxCount);
  (trail.geo.index as THREE.BufferAttribute).needsUpdate = true;
}

interface GhostInstance {
  rec: GhostRecording;
  state: SurferState;
  rig: THREE.Group;
  character: Character;
  board: Board;
  ragdoll: Ragdoll;
  trail: GhostTrail;
  pendingDt: number;
  frameIdx: number;
  finished: boolean;
  /** Wall-clock seconds elapsed since this ghost started replaying — drives trail fade. */
  ghostTime: number;
}

function makeInitialState(): SurferState {
  return {
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
  };
}

function createGhostInstance(
  scene: THREE.Scene,
  rec: GhostRecording,
): GhostInstance {
  const rig = new THREE.Group();
  rig.renderOrder = 1;
  scene.add(rig);

  const board = new Board(0xf2efe6);
  board.material.transparent = true;
  board.material.opacity = GHOST_OPACITY;
  board.material.depthWrite = false;
  rig.add(board.root);

  const character = new Character(ghostCharacterMaterials());
  rig.add(character.root);

  const ragdoll = new Ragdoll(scene, character, board);

  const state = makeInitialState();
  const trail = createGhostTrail(scene, SURFER_START_X, SURFER_START_Z);

  return {
    rec,
    state,
    rig,
    character,
    board,
    ragdoll,
    trail,
    pendingDt: 0,
    frameIdx: 0,
    finished: false,
    ghostTime: 0,
  };
}

function stepGhost(g: GhostInstance, params: PhysicsParams, liveDt: number): void {
  if (g.finished) {
    // Keep the trail fading even after the ghost stops.
    g.ghostTime += liveDt;
    if (g.ragdoll.active) {
      // Advance state.waveZ at the same rate stepSurfer would, so the ragdoll
      // sees the wave continuing to roll past it.
      g.state.waveZ += params.waveSpeed * liveDt;
      g.ragdoll.step(liveDt, g.state, params);
    }
    rebuildGhostTrail(g.trail, g.state, params, g.ghostTime);
    return;
  }

  g.pendingDt += liveDt;

  // Consume as many recorded frames as the elapsed wall time allows. This
  // pegs ghost wall-clock pace to its original recording regardless of the
  // current frame rate.
  while (!g.finished && g.frameIdx < g.rec.frames.length) {
    const frame = g.rec.frames[g.frameIdx];
    if (g.pendingDt < frame.dt) break;
    g.pendingDt -= frame.dt;
    g.frameIdx++;
    g.ghostTime += frame.dt;

    g.state.stance = frame.stance;
    const input: PhysicsInput = {
      left: frame.left,
      right: frame.right,
      up: frame.up,
      down: frame.down,
      touchHeadingTarget: frame.touchHeadingTarget,
    };

    const { gradX, gradZ } = stepSurfer(g.state, input, frame.dt, params);

    updateRigTransform(g.rig, g.state, gradX, gradZ, params);
    updateCharacterPose(g.character, g.state, input, frame.dt, frame.phase);
    emitGhostTrailSlice(g.trail, g.state, g.ghostTime);

    if (frame.phase === 'wiped_out' || frame.phase === 'missed_wave') {
      // Activate ragdoll with the just-computed wave gradients so the body
      // gets a wave-normal launch impulse matching the surfer's pose.
      g.ragdoll.activate(g.state, gradX, gradZ, params);
      g.finished = true;
    } else if (frame.phase !== 'surfing') {
      g.finished = true;
    }
  }

  if (g.frameIdx >= g.rec.frames.length) {
    g.finished = true;
  }

  rebuildGhostTrail(g.trail, g.state, params, g.ghostTime);
}

function disposeGhost(scene: THREE.Scene, g: GhostInstance): void {
  g.ragdoll.dispose();
  scene.remove(g.rig);
  g.character.dispose();
  g.board.dispose();
  scene.remove(g.trail.mesh);
  g.trail.geo.dispose();
  g.trail.mat.dispose();
}

export interface GhostManager {
  step(liveDt: number): void;
  dispose(): void;
}

export function createGhostManager(
  scene: THREE.Scene,
  level: LevelConfig,
  params: PhysicsParams,
): GhostManager {
  const ghosts: GhostInstance[] = ghostStore
    .getForLevel(level.id)
    .map((rec) => createGhostInstance(scene, rec));

  return {
    step(liveDt: number) {
      for (const g of ghosts) stepGhost(g, params, liveDt);
    },
    dispose() {
      for (const g of ghosts) disposeGhost(scene, g);
    },
  };
}

export type { GhostFrame };
