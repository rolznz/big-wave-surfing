// ─── Shore (sandy beach) ─────────────────────────────────────────────────────
// A subdivided beach strip anchored to the wave's current Z position. The
// near edge sits roughly at waveZ + SHORE_Z_OFFSET — the same line that
// triggers a wipeout when the surfer overruns the wave (see loop.ts).
//
// Not part of the distant-land backdrop: the shore is a concrete feature
// of the world that the surfer can interact with; the hills in
// distantLand.ts are purely horizon dressing.
//
// Visual goals:
//   • A clearly inclined beach face — flat at the waterline, rising
//     noticeably back toward the dunes.
//   • A wavy, non-ruler waterline.
//   • Multi-octave dune noise so the surface reads as real terrain.
//   • Vertex-painted wet/dry transition and per-dune light/shade so the
//     elevation reads even under the scene's strong flat ambient light.

import * as THREE from 'three';

import { SHORE_Z_OFFSET } from './constants';

const SAND_DEPTH      = 360;
const SAND_WIDTH      = 2400;
// Dense subdivision: enough for the wavy waterline and dunes to read as
// curves rather than polylines. X density is the important one for the
// waterline — the displacement wavelength must span many segments.
const SAND_SEGS_X     = 320;
const SAND_SEGS_Z     = 48;

// Max height of the beach at the inland edge. Tall enough that the slope
// is obvious from the chase-camera angle (~7-10° tilt off horizon).
const SAND_RISE       = 55;
// Profile curvature: 1.0 = linear; >1 keeps it flat near water and ramps
// up faster inland, which is what real beaches do.
const SAND_RISE_POWER = 1.45;

// Waterline displacement: how far in Z the near edge wiggles, and how
// quickly that wiggle fades into a clean inland surface.
const EDGE_AMP_Z      = 9;
const EDGE_FADE       = 40;

// Multi-octave dune relief. Big rolling dunes plus mid- and small-scale
// detail give the surface real texture.
const DUNE_BIG_AMP    = 3.5;
const DUNE_MID_AMP    = 1.4;
const DUNE_SMALL_AMP  = 0.55;

// Colour palette — warm enough to feel inviting in cool ocean light.
// (The scene's ambient light is cool blue — `0xbbd4ff` — which tints any
// Lambert-shaded warm colour toward green. We sidestep that by using a
// MeshBasicMaterial and baking our own shading into the vertex colour.)
const COLOR_DRY   = new THREE.Color(0xe9cb91);
const COLOR_WET   = new THREE.Color(0xb39174);
// Subtle hue shift at dune crests for a touch of sun-bleached lightness.
const COLOR_CREST = new THREE.Color(0xf6e3b6);

// Slow patchy variation (darker damp spots, lighter dry spots) so the
// beach isn't a single uniform tan.
const PATCH_FREQ = 0.018;
const PATCH_AMP  = 0.07;

// Direction TO the sun, mirroring createScene.ts's `sun.position` (15, 22, -30).
// Used to bake a directional-light term into vertex colour.
const SUN_DIR = new THREE.Vector3(15, 22, -30).normalize();
// Shading constants: ambient floor + directional contribution.
const SHADE_AMBIENT = 0.62;
const SHADE_SUN     = 0.40;

function duneHeight(x: number, z: number): number {
  // Big rolling dunes — broad, mostly along X, gently varying with Z.
  const big =
    Math.sin(x * 0.018 + 0.5) +
    0.7 * Math.cos(x * 0.011 - z * 0.006 + 1.1);
  // Mid scale — adds the broken ridges between the big rolls.
  const mid =
    Math.sin(x * 0.06  + z * 0.03 + 2.1) +
    Math.cos(x * 0.045 - z * 0.05 + 0.4);
  // Small scale — grain / ripple-like detail.
  const small =
    Math.sin(x * 0.21 + z * 0.13) +
    0.6 * Math.cos(x * 0.34 - z * 0.18 + 0.9);

  return (
    DUNE_BIG_AMP   * big * 0.5 +
    DUNE_MID_AMP   * mid * 0.5 +
    DUNE_SMALL_AMP * small * 0.5
  );
}

// Surface height including the inland slope, dune relief, and the
// inland-attenuated dune masking. Used both for placement and for
// finite-difference normal estimation.
function surfaceY(x: number, z: number): number {
  const t = Math.max(0, Math.min(1, z / SAND_DEPTH));
  const slopeY = SAND_RISE * Math.pow(t, SAND_RISE_POWER);
  const inlandness = 1 - Math.exp(-z / 25);
  return 1 + slopeY + duneHeight(x, z) * inlandness;
}

function createSandGeometry(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(
    SAND_WIDTH, SAND_DEPTH, SAND_SEGS_X, SAND_SEGS_Z,
  );
  // Plane is built in XY; rotate to XZ so the beach lies horizontally.
  geo.rotateX(-Math.PI / 2);
  // Shift so local z = 0 is the waterline edge (placed at world
  // z = waveZ + SHORE_Z_OFFSET by update()).
  geo.translate(0, 0, SAND_DEPTH / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const ox = pos.getX(i);
    const oz = pos.getZ(i);

    // Wavy waterline: push the near edge along Z. Lower frequencies so
    // adjacent X-segments span only a small fraction of a wavelength
    // (avoids the polygonal "zigzag" look). exp-fade keeps the
    // displacement local to the waterline.
    const edgeFade = Math.exp(-oz / EDGE_FADE);
    const dz =
      (Math.sin(ox * 0.022) * 1.0 +
       Math.cos(ox * 0.047 + 1.3) * 0.55 +
       Math.sin(ox * 0.013 - 0.6) * 0.35) * EDGE_AMP_Z * edgeFade;
    // Clamp the displaced z so it never goes below 0. A negative z would
    // overshoot the wet/dry lerp (wetness > 1), pushing R below G in the
    // colour mix and producing the bright green-yellow artefacts at the
    // wavy edge.
    const z = Math.max(0, oz + dz);

    const y = surfaceY(ox, z);
    pos.setY(i, y);
    pos.setZ(i, z);

    // ── Colouring ────────────────────────────────────────────────────
    // Wet/dry: near the waterline blend toward the wet tone. Narrow band
    // (~10 unit decay) so the bulk of the beach reads as dry sand. Wetness
    // clamped to 1 — overshooting the lerp drives channels negative and
    // the negatives get exposed as colour artefacts after framebuffer
    // clamping (see comment on the z clamp above).
    const wetness = Math.min(1, Math.exp(-z / 10));
    tmpColor.copy(COLOR_DRY).lerp(COLOR_WET, wetness);

    // Crest lightening: dunes peaking above the underlying slope get a
    // touch of the brighter crest tone.
    const t = Math.max(0, Math.min(1, z / SAND_DEPTH));
    const slopeY = SAND_RISE * Math.pow(t, SAND_RISE_POWER);
    const dY = y - slopeY;
    const crestiness = Math.max(0, dY / (DUNE_BIG_AMP + DUNE_MID_AMP));
    tmpColor.lerp(COLOR_CREST, Math.min(1, crestiness) * 0.45);

    // Patchy variation — slow, low-amplitude brightness modulation.
    const patch =
      1 + PATCH_AMP * (
        Math.sin(ox * PATCH_FREQ + 0.7) +
        Math.cos(ox * PATCH_FREQ * 0.6 + z * PATCH_FREQ * 0.8)
      ) * 0.5;
    tmpColor.multiplyScalar(patch);

    // Baked directional shading. Finite-difference normal from surfaceY,
    // then dot with the sun direction. With MeshBasicMaterial this is the
    // only shading the beach gets — but it lets us pick the light colour
    // (white sun) rather than inheriting the scene's cool blue ambient.
    const EPS = 1.0;
    const dyDx = (surfaceY(ox + EPS, z) - surfaceY(ox - EPS, z)) / (2 * EPS);
    const dyDz = (surfaceY(ox, z + EPS) - surfaceY(ox, z - EPS)) / (2 * EPS);
    const nLen = Math.sqrt(dyDx * dyDx + 1 + dyDz * dyDz);
    const nx = -dyDx / nLen;
    const ny =  1    / nLen;
    const nz = -dyDz / nLen;
    const sunDot = Math.max(0, nx * SUN_DIR.x + ny * SUN_DIR.y + nz * SUN_DIR.z);
    const shade  = SHADE_AMBIENT + SHADE_SUN * sunDot;
    tmpColor.multiplyScalar(shade);

    colors[i * 3]     = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export interface Shore {
  mesh: THREE.Mesh;
  // surferX keeps the strip laterally centred on the player; waveZ anchors
  // its near edge to the shore-collision line.
  update: (surferX: number, waveZ: number) => void;
  dispose: () => void;
}

export function createShore(): Shore {
  const geo = createSandGeometry();
  // MeshBasicMaterial + vertexColors: we bake our own directional shading
  // into the vertex colour, so the beach renders without inheriting the
  // scene's cool-blue ambient tint (which made it look green/burned under
  // Lambert).
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -0.4;
  mesh.frustumCulled = false;

  return {
    mesh,
    update: (surferX, waveZ) => {
      mesh.position.x = surferX;
      mesh.position.z = waveZ + SHORE_Z_OFFSET;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}
