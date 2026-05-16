// ─── Birds ───────────────────────────────────────────────────────────────────
// A small flock of V-shaped silhouettes drifting through the sky. Each bird
// is a 3-vertex THREE.Line (left wing, body, right wing) with the wing tip
// Y coordinates animated by a sin wave for the flap. Birds drift across
// the scene at low speeds; if a bird wanders too far from the surfer it
// wraps to the opposite side so the flock stays visually near the camera.

import * as THREE from 'three';

const BIRD_COUNT      = 5;
const SPAWN_RADIUS    = 220;   // initial / wrap-respawn radius
const WRAP_RADIUS     = 320;   // bird wraps once farther than this
const ALT_MIN         = 28;
const ALT_MAX         = 75;
const DRIFT_MIN       = 2.5;
const DRIFT_MAX       = 6.0;
const WINGSPAN_MIN    = 2.4;
const WINGSPAN_MAX    = 4.2;

interface Bird {
  line:       THREE.Line;
  pos:        THREE.BufferAttribute;
  vx:         number;
  vz:         number;
  flapPhase:  number;
  flapSpeed:  number;
}

export interface Birds {
  group: THREE.Group;
  update: (dt: number, centerPos: THREE.Vector3) => void;
  dispose: () => void;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function makeBird(): Bird {
  const geo = new THREE.BufferGeometry();
  // Left wing tip, body center, right wing tip. Wing-tip Y is animated below
  // for the flap; initial value is a mid-flap up-angle.
  const positions = new Float32Array([
    -1, 0.25, 0,
     0, 0,    0,
     1, 0.25, 0,
  ]);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0x2b3a4a,
    fog: true,
    transparent: true,
    opacity: 0.85,
  });
  const line = new THREE.Line(geo, mat);

  const scale = rand(WINGSPAN_MIN, WINGSPAN_MAX);
  line.scale.setScalar(scale);

  // Random initial drift heading.
  const heading = Math.random() * Math.PI * 2;
  const speed   = rand(DRIFT_MIN, DRIFT_MAX);

  return {
    line,
    pos:       geo.attributes.position as THREE.BufferAttribute,
    vx:        Math.sin(heading) * speed,
    vz:        Math.cos(heading) * speed,
    flapPhase: Math.random() * Math.PI * 2,
    flapSpeed: rand(3.5, 6.5),
  };
}

export function createBirds(): Birds {
  const group = new THREE.Group();
  const birds: Bird[] = [];

  for (let i = 0; i < BIRD_COUNT; i++) {
    const b = makeBird();
    const angle = Math.random() * Math.PI * 2;
    const r = rand(80, SPAWN_RADIUS);
    b.line.position.set(
      Math.cos(angle) * r,
      rand(ALT_MIN, ALT_MAX),
      Math.sin(angle) * r,
    );
    group.add(b.line);
    birds.push(b);
  }

  return {
    group,
    update: (dt, centerPos) => {
      for (const b of birds) {
        // Drift across the sky.
        b.line.position.x += b.vx * dt;
        b.line.position.z += b.vz * dt;

        // Wing flap: animate the wing-tip Y values (vertices 0 and 2).
        b.flapPhase += b.flapSpeed * dt;
        const wingY = 0.18 + 0.22 * Math.sin(b.flapPhase);
        b.pos.setY(0, wingY);
        b.pos.setY(2, wingY);
        b.pos.needsUpdate = true;

        // Yaw to face the direction of travel.
        b.line.rotation.y = Math.atan2(b.vx, b.vz);

        // Wrap when the bird flies too far from the surfer — respawn on
        // the opposite side at the spawn radius so the flock stays near
        // the camera.
        const dx = b.line.position.x - centerPos.x;
        const dz = b.line.position.z - centerPos.z;
        const dist2 = dx * dx + dz * dz;
        if (dist2 > WRAP_RADIUS * WRAP_RADIUS) {
          const a = Math.atan2(dz, dx) + Math.PI;
          b.line.position.x = centerPos.x + Math.cos(a) * SPAWN_RADIUS;
          b.line.position.z = centerPos.z + Math.sin(a) * SPAWN_RADIUS;
          b.line.position.y = rand(ALT_MIN, ALT_MAX);
        }
      }
    },
    dispose: () => {
      for (const b of birds) {
        b.line.geometry.dispose();
        (b.line.material as THREE.Material).dispose();
      }
    },
  };
}
