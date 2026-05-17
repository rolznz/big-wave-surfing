import * as THREE from 'three';
import type { LevelConfig } from './levels';
import type { Rng } from './rng';

// Obstacles are stationary in world space. They were authored at the moment
// the wave was at a particular Z, with Y set to the wave surface at that
// instant — once placed, they don't move. The wave passes through them as
// it travels in +Z, so the player must be at a specific world Z (not just a
// wave-relative offset) at the right moment to encounter them.

export interface Obstacle {
  kind: 'rock';
  x: number;
  y: number;
  z: number;
  radius: number;
  mesh: THREE.Mesh;
}

export type HeightSampler = (worldX: number, worldZ: number) => number;

export interface ObstacleSystem {
  obstacles: readonly Obstacle[];
  /**
   * Collide (surferX, surferY, surferZ) against the fixed-XYZ rocks.
   * Y check prevents phantom hits when the surfer is at a very different
   * altitude than the rock (e.g. on the back of the wave, high above a rock).
   */
  check(x: number, y: number, z: number): Obstacle | null;
  dispose(): void;
}

const ROCK_COLOR = 0x4a3a2a;

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
  const obstacles: Obstacle[] = [];
  const disposables: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  for (const p of level.obstaclePlacements ?? []) {
    const mesh = makeRockMesh(p.radius, rng);
    // Sit the rock's centre slightly below its authored Y so its craggy top
    // peeks above the water rather than the geometric centre clipping at the
    // surface.
    const renderY = p.y - p.radius * 0.3;
    mesh.position.set(p.x, renderY, p.z);
    scene.add(mesh);
    disposables.push(mesh.geometry as THREE.BufferGeometry);
    materials.push(mesh.material as THREE.Material);
    obstacles.push({ kind: 'rock', x: p.x, y: p.y, z: p.z, radius: p.radius, mesh });
  }

  return {
    obstacles,
    check(x, y, z) {
      for (const o of obstacles) {
        const xz = Math.hypot(o.x - x, o.z - z);
        if (xz >= o.radius) continue;
        if (Math.abs(y - o.y) < o.radius) return o;
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
