// ─── Distant land ────────────────────────────────────────────────────────────
// Silhouette ring of rolling hills around the surfer at a fixed apparent
// distance — purely a horizon backdrop, not something the player interacts
// with. The shore (sand the surfer can run aground on) is a separate
// concept; see shore.ts.
//
// Geometry: a single arc of triangles between a bottom ring at sea level
// and a top ring whose height is modulated by sin sums and tapered to 0 at
// the arc's ends so the silhouette dissolves cleanly into the open-water
// horizon at the gap.

import * as THREE from 'three';

const RADIUS         = 420;
const ARC_SEGMENTS   = 128;
const HEIGHT_MAX     = 100;

// Angles use the standard convention (a=0 → +X, a=π/2 → +Z, a=π → -X,
// a=3π/2 → -Z). The arc is centred on +Z (shore side) and the open-ocean
// gap sits on -Z; flip ARC_CENTER if the camera convention changes.
// Total arc ≈ 310°, leaving a ~50° gap toward the open horizon. The visible
// (tall) portion is narrower than the geometric arc because of the edge
// taper below, so the arc is set wider than the desired silhouette.
const ARC_CENTER     = Math.PI / 2;
const ARC_HALF_WIDTH = Math.PI * 0.82;

function createHillsGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices:   number[] = [];

  const aStart = ARC_CENTER - ARC_HALF_WIDTH;
  const aEnd   = ARC_CENTER + ARC_HALF_WIDTH;

  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const t = i / ARC_SEGMENTS;
    const a = aStart + t * (aEnd - aStart);
    const x = Math.cos(a) * RADIUS;
    const z = Math.sin(a) * RADIUS;

    // Window function: 0 at arc ends, 1 in the middle, so the silhouette
    // sinks to sea level at the boundary and blends into the open-ocean
    // horizon without a visible vertical cut. The sqrt flattens the top of
    // the window so the tall portion covers more of the arc (rather than
    // bunching height into the centre).
    const taper = Math.sqrt(Math.sin(t * Math.PI));

    // Constant offset keeps the value positive across the arc so we never
    // dip below sea level.
    const base = 0.60
      + 0.25 * Math.sin(a * 5  + 1.7)
      + 0.15 * Math.sin(a * 11 + 0.4)
      + 0.08 * Math.sin(a * 17 + 2.1);
    const h = Math.max(0, base) * HEIGHT_MAX * taper;

    positions.push(x, 0, z);
    positions.push(x, h, z);
  }

  for (let i = 0; i < ARC_SEGMENTS; i++) {
    const i0 = i * 2;
    const i1 = i * 2 + 1;
    const j0 = (i + 1) * 2;
    const j1 = (i + 1) * 2 + 1;
    indices.push(i0, i1, j0);
    indices.push(i1, j1, j0);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export interface DistantLand {
  mesh: THREE.Mesh;
  update: (surferPos: THREE.Vector3) => void;
  dispose: () => void;
}

export function createDistantLand(): DistantLand {
  const geo = createHillsGeometry();
  // Tinted mid-blue so fog blending pulls the silhouette toward the horizon
  // haze colour (0xdbeef7) naturally with distance.
  const mat = new THREE.MeshBasicMaterial({
    color: 0x7593b8,
    fog: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    transparent: true,
    opacity: 0.92,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -0.5;       // between sky (-1) and water (default 0)
  mesh.frustumCulled = false;

  return {
    mesh,
    update: (surferPos) => {
      // Follows the surfer in XZ — hills are an apparent-distance backdrop
      // and should stay at constant angular size as the run progresses.
      mesh.position.x = surferPos.x;
      mesh.position.z = surferPos.z;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}
