import * as THREE from 'three';
import type { LevelConfig } from './levels';
import type { Rng } from './rng';

// Stars are stationary in world space — the wave moves past them, same as
// rocks. Authored Y is the surfer's recorded height at the snap frame, so a
// star above the path corresponds to an air the designer did during recording.

export interface Star {
  x: number;
  y: number;
  z: number;
  radius: number;
  mesh: THREE.Mesh;
  /** Y the mesh sits at before bob is applied. Authored y + STAR_HOVER. */
  baseY: number;
  collected: boolean;
}

export interface StarSystem {
  readonly stars: readonly Star[];
  readonly total: number;
  readonly collectedCount: number;
  update(dt: number): void;
  /** If the point is within a star's pickup volume, mark it collected. */
  tryCollect(x: number, y: number, z: number): Star | null;
  /** Uncollected stars whose X lies behind the surfer by at least MISS_PAD. */
  missedCount(surferX: number): number;
  dispose(): void;
}

const STAR_RADIUS = 2;          // outer points of the star shape
const STAR_PICKUP_PAD = 1.5;    // generous XZ pickup radius beyond body
const STAR_HOVER = 1.6;         // units above the water surface
// A star counts as "missed" once the surfer has moved past it in X by more
// than the pickup radius — at that point it's no longer reachable.
const MISS_PAD = STAR_RADIUS + STAR_PICKUP_PAD;

// Collection burst — shards fly out from the star and fall, fading over BURST_LIFE.
const BURST_SHARDS = 14;
const BURST_LIFE = 0.55;        // seconds until shards vanish
const BURST_SPEED = 9;          // outward velocity magnitude
const BURST_UP_BIAS = 4;        // extra vertical velocity — pops up before falling
const BURST_GRAVITY = 22;       // downward accel (u/s²)
const FLASH_LIFE = 0.25;
const FLASH_MAX_SCALE = 4.5;

interface Burst {
  shards: THREE.Mesh[];
  vx: number[]; vy: number[]; vz: number[];
  spin: number[];
  material: THREE.MeshBasicMaterial;
  flash: THREE.Mesh;
  flashMat: THREE.MeshBasicMaterial;
  age: number;
}

function makeStarShape(points: number, inner: number, outer: number): THREE.Shape {
  const shape = new THREE.Shape();
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = i * step - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function makeStarMesh(radius: number): THREE.Mesh {
  const shape = makeStarShape(5, radius * 0.45, radius);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: radius * 0.3,
    bevelEnabled: true,
    bevelThickness: radius * 0.1,
    bevelSize: radius * 0.08,
    bevelSegments: 2,
    curveSegments: 2,
  });
  geo.center();
  const mat = new THREE.MeshPhongMaterial({
    color: 0xffd23f,
    emissive: 0x8a5a00,
    specular: 0xffffff,
    shininess: 110,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.renderOrder = 2;
  return mesh;
}

export function createStars(
  scene: THREE.Scene,
  level: LevelConfig,
  rng: Rng,
): StarSystem {
  const stars: Star[] = [];
  const disposables: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  for (const p of level.starPlacements ?? []) {
    const baseY = p.y + STAR_HOVER;
    const mesh = makeStarMesh(STAR_RADIUS);
    mesh.position.set(p.x, baseY, p.z);
    scene.add(mesh);
    disposables.push(mesh.geometry as THREE.BufferGeometry);
    materials.push(mesh.material as THREE.Material);
    stars.push({
      x: p.x, y: p.y, z: p.z,
      radius: STAR_RADIUS, mesh, baseY, collected: false,
    });
  }
  const total = stars.length;

  // Shared geometry for all burst shards — small spiky tetrahedra, yellow.
  const shardGeo = new THREE.TetrahedronGeometry(0.5, 0);
  disposables.push(shardGeo);
  const flashGeo = new THREE.SphereGeometry(1, 10, 8);
  disposables.push(flashGeo);

  const bursts: Burst[] = [];

  function spawnBurst(wx: number, wy: number, wz: number) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe14a,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shards: THREE.Mesh[] = [];
    const vx: number[] = [], vy: number[] = [], vz: number[] = [];
    const spinVel: number[] = [];
    for (let i = 0; i < BURST_SHARDS; i++) {
      const mesh = new THREE.Mesh(shardGeo, mat);
      mesh.position.set(wx, wy, wz);
      // Random direction biased upward.
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(2 * rng() - 1);
      const dx = Math.sin(phi) * Math.cos(theta);
      const dy = Math.cos(phi);
      const dz = Math.sin(phi) * Math.sin(theta);
      const speed = BURST_SPEED * (0.7 + rng() * 0.6);
      vx.push(dx * speed);
      vy.push(dy * speed + BURST_UP_BIAS);
      vz.push(dz * speed);
      spinVel.push((rng() - 0.5) * 20);
      mesh.renderOrder = 3;
      scene.add(mesh);
      shards.push(mesh);
    }
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xfff4b0,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(wx, wy, wz);
    flash.scale.setScalar(0.5);
    flash.renderOrder = 3;
    scene.add(flash);
    bursts.push({
      shards, vx, vy, vz, spin: spinVel,
      material: mat, flash, flashMat, age: 0,
    });
  }

  function updateBursts(dt: number) {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.age += dt;

      // Flash: expand then fade in first FLASH_LIFE seconds.
      if (b.age < FLASH_LIFE) {
        const t = b.age / FLASH_LIFE;
        b.flash.scale.setScalar(0.5 + t * (FLASH_MAX_SCALE - 0.5));
        b.flashMat.opacity = 0.85 * (1 - t);
      } else if (b.flash.visible) {
        b.flash.visible = false;
      }

      // Shards: integrate velocity + gravity, fade opacity.
      const fade = Math.max(0, 1 - b.age / BURST_LIFE);
      b.material.opacity = fade;
      for (let j = 0; j < b.shards.length; j++) {
        const m = b.shards[j];
        b.vy[j] -= BURST_GRAVITY * dt;
        m.position.x += b.vx[j] * dt;
        m.position.y += b.vy[j] * dt;
        m.position.z += b.vz[j] * dt;
        m.rotation.x += b.spin[j] * dt;
        m.rotation.y += b.spin[j] * 0.7 * dt;
        m.scale.setScalar(0.4 + fade * 0.9);
      }

      if (b.age >= BURST_LIFE) {
        for (const m of b.shards) scene.remove(m);
        scene.remove(b.flash);
        b.material.dispose();
        b.flashMat.dispose();
        bursts.splice(i, 1);
      }
    }
  }

  let spin = 0;
  let collectedCount = 0;

  const system: StarSystem = {
    stars,
    total,
    get collectedCount() { return collectedCount; },
    update(dt) {
      spin += dt;
      for (const s of stars) {
        if (s.collected) continue;
        // Small in-place vertical bob + spin so the star still feels alive
        // without sliding around with the wave.
        const bob = Math.sin(spin * 2 + s.x * 0.07) * 0.25;
        s.mesh.position.y = s.baseY + bob;
        s.mesh.rotation.y = spin * 2;
      }
      updateBursts(dt);
    },
    tryCollect(x, y, z) {
      for (const s of stars) {
        if (s.collected) continue;
        const xz = Math.hypot(s.x - x, s.z - z);
        if (xz >= s.radius + STAR_PICKUP_PAD) continue;
        // Vertical reach matches hover distance + star size, so the surfer
        // needs to be near the star's authored height (not way below or above).
        if (Math.abs(y - s.baseY) > s.radius + STAR_HOVER) continue;
        s.collected = true;
        s.mesh.visible = false;
        collectedCount++;
        spawnBurst(s.x, s.baseY, s.z);
        return s;
      }
      return null;
    },
    missedCount(surferX) {
      let n = 0;
      for (const s of stars) {
        if (!s.collected && surferX - s.x > MISS_PAD) n++;
      }
      return n;
    },
    dispose() {
      for (const s of stars) scene.remove(s.mesh);
      for (const b of bursts) {
        for (const m of b.shards) scene.remove(m);
        scene.remove(b.flash);
        b.material.dispose();
        b.flashMat.dispose();
      }
      bursts.length = 0;
      for (const g of disposables) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
  return system;
}
