import * as THREE from 'three';
import { SURFER_START_X } from './constants';
import type { LevelConfig } from './levels';
import { levelGoalX } from './levels';
import type { Rng } from './rng';

// Obstacles live in the wave's moving frame: their world-X is fixed but their
// world-Z is `waveZ + zOffset`. That keeps them on the wave face as the wave
// (and surfer) travel forward in +Z through the world — a static world-Z would
// drop behind the wave within a few seconds and end up in the whitewater.

export interface Obstacle {
  kind: 'rock';
  x: number;
  zOffset: number;   // +Z of the wave crest (positive = clean front face)
  radius: number;
  mesh: THREE.Mesh;
  /** Current world Y of the rock's centre — tracks the wave surface. */
  worldY: number;
}

export type HeightSampler = (worldX: number, worldZ: number) => number;

export interface ObstacleSystem {
  obstacles: readonly Obstacle[];
  /** Reposition meshes after the wave has advanced. */
  update(waveZ: number, sampleHeight: HeightSampler): void;
  /**
   * Collide (surferX, surferY, surferZ) in world coords given current waveZ.
   * Y check prevents phantom hits when the surfer is at a very different
   * altitude than the rock (e.g. on the back of the wave, high above a rock
   * that's sitting low on the shoulder ahead).
   */
  check(x: number, y: number, z: number, waveZ: number): Obstacle | null;
  dispose(): void;
}

const ROCK_COLOR = 0x4a3a2a;

// Rocks sit on the wave's front face — the steep side the surfer drops down.
// The front face gaussian has sigma 10; 3–12 units ahead of the crest keeps
// the rock visibly "on the wave" without perching on the crest itself.
const Z_OFFSET_MIN = 0;
const Z_OFFSET_MAX = 30;
const MIN_SEPARATION = 12;

function makeRockMesh(radius: number, rng: Rng): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  // IcosahedronGeometry is non-indexed — every face has its own copy of each
  // corner vertex. If each copy gets an independent random jitter, adjacent
  // faces pull apart at their shared corner, leaving gaps. Key by rounded
  // original position so duplicates receive the same displacement.
  const jitterByKey = new Map<string, [number, number, number]>();
  const amp = radius * 0.35;
  for (let i = 0; i < pos.count; i++) {
    const ox = pos.getX(i), oy = pos.getY(i), oz = pos.getZ(i);
    const key = `${ox.toFixed(4)},${oy.toFixed(4)},${oz.toFixed(4)}`;
    let j = jitterByKey.get(key);
    if (!j) {
      j = [(rng() - 0.5) * amp, (rng() - 0.5) * amp, (rng() - 0.5) * amp];
      jitterByKey.set(key, j);
    }
    pos.setXYZ(i, ox + j[0], oy + j[1], oz + j[2]);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mat = new THREE.MeshPhongMaterial({
    color: ROCK_COLOR,
    specular: 0x222222,
    shininess: 20,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

export function createObstacles(
  scene: THREE.Scene,
  level: LevelConfig,
  rng: Rng,
): ObstacleSystem {
  const specs = level.obstacles ?? [];
  const obstacles: Obstacle[] = [];
  const disposables: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const goalX = levelGoalX(level);
  // Spawn X range: ahead of the start position, before the goal. Rocks near
  // the very start would be unavoidable before the surfer has any speed.
  const xMin = SURFER_START_X + 40;
  const xMax = goalX - 20;

  for (const spec of specs) {
    if (spec.kind !== 'rock') continue;
    for (let i = 0; i < spec.count; i++) {
      let x = 0, zOffset = 0;
      for (let tries = 0; tries < 10; tries++) {
        x = xMin + rng() * (xMax - xMin);
        zOffset = Z_OFFSET_MIN + rng() * (Z_OFFSET_MAX - Z_OFFSET_MIN);
        const clash = obstacles.some(
          (o) => Math.hypot(o.x - x, o.zOffset - zOffset) < MIN_SEPARATION,
        );
        if (!clash) break;
      }
      const radius = 2 + rng() * 2.5;
      const mesh = makeRockMesh(radius, rng);
      mesh.position.set(x, 0, 0);   // y/z filled in by update() each frame
      scene.add(mesh);
      disposables.push(mesh.geometry as THREE.BufferGeometry);
      materials.push(mesh.material as THREE.Material);
      obstacles.push({ kind: 'rock', x, zOffset, radius, mesh, worldY: 0 });
    }
  }

  return {
    obstacles,
    update(waveZ, sampleHeight) {
      for (const o of obstacles) {
        const z = waveZ + o.zOffset;
        // Sit the rock's centre a little below the wave surface so its
        // craggy top peeks out — avoids a rock floating entirely in air
        // when sitting on flat water behind the break.
        const surfaceY = sampleHeight(o.x, z);
        o.worldY = surfaceY - o.radius * 0.3;
        o.mesh.position.y = o.worldY;
        o.mesh.position.z = z;
      }
    },
    check(x, y, z, waveZ) {
      for (const o of obstacles) {
        const oz = waveZ + o.zOffset;
        const xz = Math.hypot(o.x - x, oz - z);
        if (xz >= o.radius) continue;
        // Y overlap: rock spans roughly [worldY - r, worldY + r]. Surfer is
        // a point on the wave surface. Allow collision within ±radius.
        if (Math.abs(y - o.worldY) < o.radius) return o;
      }
      return null;
    },
    dispose() {
      for (const o of obstacles) scene.remove(o.mesh);
      for (const g of disposables) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
