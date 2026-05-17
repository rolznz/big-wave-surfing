import * as THREE from 'three';
import {
  WAVE_AMP, WAVE_SIGMA_FRONT, WAVE_SIGMA_BACK,
  WAVE_X_DECAY, WAVE_X_BROKEN_DECAY, WAVE_X_SIGMA_SCALE,
  WAVE_PEAK_AHEAD_X,
  WAVE_STRIP_W, WAVE_STRIP_D, WAVE_STRIP_SEG_X, WAVE_STRIP_SEG_Z,
  WAVE_STRIP_OFFSET_Z, WAVE_STRIP_EDGE_TAPER,
  FOAM_CHOP_SCALE, FOAM_CHOP_SPEED, FOAM_CHOP_STRENGTH,
  FOAM_HEIGHT_FRAC, FOAM_PARALLAX, FOAM_CASCADE_SPEED,
  BREAK_SPEED,
  TRAIL_LIFT,
  FACE_TINT_STRENGTH, BACK_DARKEN_STRENGTH,
} from './constants';
import { createWhitewaterMaterial, WHITEWATER_ATTR } from './whitewater';
import { makeSurfaceFoamTexture, createSurfaceFoamMaterial } from './surfaceFoam';
import type { Rng } from './rng';

// ─── Wave profile ────────────────────────────────────────────────────────────

/**
 * Wave height at (worldZ, worldX).
 * - Z profile: asymmetric Gaussian centred at waveZ (steep front, gentle back).
 * - X profile: amplitude peaks just ahead of breakX (on the clean side) and
 *   decays exponentially in both directions — fast on the broken side
 *   (whitewater loses energy), slow on the clean shoulder. The back-slope
 *   sigma also widens as we move right along the clean shoulder.
 *
 * `peakAmp` is the crest amplitude (per-level scaling happens by the caller
 * passing a pre-multiplied value — defaults to WAVE_AMP for unscaled use).
 */
export function waveHeightAt(
  worldZ: number,
  waveZ: number,
  worldX = 0,
  breakX = 0,
  peakAmp: number = WAVE_AMP,
  sigmaFrontBase: number = WAVE_SIGMA_FRONT,
  sigmaBackBase: number = WAVE_SIGMA_BACK,
  decayMultiplier: number = 1
): number {
  const rel = worldZ - waveZ;
  const peakX = breakX + WAVE_PEAK_AHEAD_X;
  const xDistClean  = Math.max(0, worldX - peakX);
  const xDistBroken = Math.max(0, peakX - worldX);
  const amp = peakAmp
    * Math.exp(-xDistClean  / WAVE_X_DECAY * decayMultiplier)
    * Math.exp(-xDistBroken / WAVE_X_BROKEN_DECAY * decayMultiplier);
  const sigmaBack = sigmaBackBase + xDistClean / WAVE_X_SIGMA_SCALE;
  const sigma = rel >= 0 ? sigmaFrontBase : sigmaBack;
  return amp * Math.exp(-(rel * rel) / (2 * sigma * sigma));
}

// ─── Whitewater foam mask ────────────────────────────────────────────────────

/**
 * Foam coverage at world (wx, wz) for the given wave state. Returns the
 * combined mask (crest foam + lip rope + forward trail). The trail's forward
 * extent down the face is gated by `timeSinceBroken = (breakX - wx) / BREAK_SPEED`,
 * so when a column first breaks the foam appears at the lip only and rolls
 * forward over `25 / FOAM_CASCADE_SPEED` seconds.
 *
 * `crestFoamOut` (optional length-1 buffer) receives just the crest-foam
 * component, used by the mesh updater to drive normal perturbation.
 *
 * Same formula is used by the per-vertex mesh shader and the per-frame
 * balance hit-test — single source of truth keeps visual ≡ gameplay.
 */
export function foamMaskAt(
  wx: number, wz: number,
  waveZ: number, breakX: number,
  peakAmp: number = WAVE_AMP,
  sigmaFront: number = WAVE_SIGMA_FRONT,
  sigmaBack: number = WAVE_SIGMA_BACK,
  edgeFactor: number = 1,
  crestFoamOut?: { value: number },
): number {
  const h = waveHeightAt(wz, waveZ, wx, breakX, peakAmp, sigmaFront, sigmaBack) * edgeFactor;
  const heightFactor = Math.min(1, h / (peakAmp * FOAM_HEIGHT_FRAC));
  const rel = wz - waveZ;

  const foamDist = breakX - wx;
  const crestFoam = Math.max(0, Math.min(1, foamDist / 4)) * heightFactor;
  const lipMask   = Math.max(0, 1 - Math.abs(wx - breakX) / 3) * heightFactor;

  const trailX = Math.max(0, Math.min(1, foamDist / 15));
  const trailZFront = Math.max(0, Math.min(1, 1 - rel / 25));
  const trailZBack  = Math.max(0, Math.min(1, (rel + 4) / 4));
  const trailMask = trailX * trailZFront * trailZBack;

  // Cascade gate — applies down the face (rel > 0). When breakX has just
  // passed this X column, extentAhead is 0 so foam only exists at the lip
  // (rel ≤ 0). Over `25 / FOAM_CASCADE_SPEED` seconds it rolls forward
  // until the full 25-unit front-face extent is covered. Back of crest
  // (rel ≤ 0) is never gated — the lip itself is always foaming once broken.
  const timeSinceBroken = Math.max(0, foamDist / BREAK_SPEED);
  const extentAhead = timeSinceBroken * FOAM_CASCADE_SPEED;
  const CASCADE_FALLOFF = 4;
  const cascadeGate = rel <= 0
    ? 1
    : Math.max(0, Math.min(1, 1 - (rel - extentAhead) / CASCADE_FALLOFF));

  if (crestFoamOut) crestFoamOut.value = crestFoam * cascadeGate;
  return Math.max(crestFoam, lipMask * 1.4, trailMask * 0.85) * cascadeGate;
}

// ─── Cheap 3D value noise (for foam surface chop) ────────────────────────────

function hash3(x: number, y: number, z: number): number {
  let h = ((x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 2147483647) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const sz = zf * zf * (3 - 2 * zf);
  const c000 = hash3(xi,     yi,     zi    );
  const c100 = hash3(xi + 1, yi,     zi    );
  const c010 = hash3(xi,     yi + 1, zi    );
  const c110 = hash3(xi + 1, yi + 1, zi    );
  const c001 = hash3(xi,     yi,     zi + 1);
  const c101 = hash3(xi + 1, yi,     zi + 1);
  const c011 = hash3(xi,     yi + 1, zi + 1);
  const c111 = hash3(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * sx;
  const x10 = c010 + (c110 - c010) * sx;
  const x01 = c001 + (c101 - c001) * sx;
  const x11 = c011 + (c111 - c011) * sx;
  const y0 = x00 + (x10 - x00) * sy;
  const y1 = x01 + (x11 - x01) * sy;
  return y0 + (y1 - y0) * sz;
}

// ─── Background swell crests ─────────────────────────────────────────────────
// Parallel crests at fixed Z offsets from the main wave. They share the
// main wave's full profile — same Z gaussian (sigmaFront / sigmaBack) and
// same asymmetric X shape (peak just ahead of breakX, fast decay on the
// broken side, slow decay on the clean shoulder) — so they look like the
// same swell train, just unbroken (no foam / whitewater) and offset down
// the swell. They travel with waveZ automatically because their position
// is computed relative to it each frame.
const BG_WAVE_Z_OFFSETS = [-150, -350, -550];
const BG_WAVE_X_OFFSETS = [-200, 300, -200];
const BG_WAVE_AMP_SCALE = [0.35, 0.25, 0.35];
// Further-back swells haven't reached the same point of the break yet, so
// their peak sits further to the left (smaller breakX). Per-swell -X offset.

function backgroundWaveHeight(
  wz: number,
  waveZ: number,
  wx: number,
  breakX: number,
  peakAmp: number,
  sigmaFrontBase: number,
  sigmaBackBase: number,
): number {
  let h = 0;
  for (let i = 0; i < BG_WAVE_Z_OFFSETS.length; i++) {
    const bgWaveZ = waveZ + BG_WAVE_Z_OFFSETS[i];
    const bgBreakX = breakX + BG_WAVE_X_OFFSETS[i];
    h += waveHeightAt(
      wz, bgWaveZ, wx, bgBreakX,
      peakAmp * BG_WAVE_AMP_SCALE[i],
      sigmaFrontBase, sigmaBackBase,
      0.35
    );
  }
  return h;
}

// ─── Vertex colour helpers ────────────────────────────────────────────────────

const COL_DEEP        = new THREE.Color(0x2f6fb8);
const COL_FACE        = new THREE.Color(0x0077aa);
const COL_CREST       = new THREE.Color(0x00ccff);
const COL_FOAM        = new THREE.Color(0xddf5ff);
const COL_TRANSLUCENT = new THREE.Color(0x40ddc8);   // backlit turquoise for the front face
const _tmp = new THREE.Color();
const _crestOut = { value: 0 };

function vertexColor(height: number, foam: number, out: THREE.Color): void {
  const t = Math.min(1, height / WAVE_AMP);
  if (foam > 0.05) {
    out.lerpColors(COL_FACE, COL_FOAM, foam);
  } else if (t < 0.5) {
    out.lerpColors(COL_DEEP, COL_FACE, t * 2);
  } else {
    out.lerpColors(COL_FACE, COL_CREST, (t - 0.5) * 2);
  }
}

// ─── WaveOcean ───────────────────────────────────────────────────────────────

export interface WaveOceanParams {
  startZ: number;
  peakAmp: number;
  waveSpeed: number;
  breakSpeed: number;
  sigmaFront: number;
  sigmaBack: number;
  rng: Rng;
}

// Modulo that handles negatives correctly (JS `%` returns negative for negatives).
function mod1(x: number): number {
  const r = x - Math.floor(x);
  return r;
}

export class WaveOcean {
  readonly mesh: THREE.Mesh;
  readonly whitewaterMesh: THREE.Mesh;
  readonly surfaceFoamMesh: THREE.Mesh;

  /** Current world-Z position of the wave crest. */
  waveZ: number;

  readonly peakAmp: number;
  readonly waveSpeed: number;
  readonly breakSpeed: number;
  readonly sigmaFront: number;
  readonly sigmaBack: number;

  private readonly geo: THREE.BufferGeometry;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly normAttr: THREE.BufferAttribute;
  private readonly foamBuf: Float32Array;

  // Whitewater overlay: opaque foam on the broken/lip/trail regions.
  private readonly wwGeo: THREE.BufferGeometry;
  private readonly wwPosAttr: THREE.BufferAttribute;
  private readonly wwMaskAttr: THREE.BufferAttribute;
  private readonly wwMat: THREE.ShaderMaterial;

  // Surface foam overlay: bubble texture across the whole wave face.
  private readonly sfGeo: THREE.BufferGeometry;
  private readonly sfPosAttr: THREE.BufferAttribute;
  private readonly sfColAttr: THREE.BufferAttribute;
  private readonly sfMat: THREE.MeshBasicMaterial;
  private readonly sfTex: THREE.Texture;

  // Sparkle uniforms injected into MeshPhongMaterial via onBeforeCompile.
  // Same object is wired into the compiled shader, so updating .value here
  // updates the GPU-side uniform.
  private readonly sparkleUniforms = {
    uSparkleTime: { value: 0 },
    // Must match the directional light in createScene.ts — this is the
    // direction TO the sun, used to compute reflection toward the camera.
    // Negative Z so the sun sits in front of the (chase) camera, which
    // looks in -Z. Otherwise the reflected glint shoots away from us.
    uSunDir: { value: new THREE.Vector3(15, 22, -30).normalize() },
    // Overall multiplier for the sun-glint pass. Typically wired to the
    // directional light's intensity so dialing the sun down dims the
    // glint proportionally. 0 = no glint; 1 = baseline.
    uSparkleStrength: { value: 1.0 },
  };

  /** Set the overall sun-glint multiplier (broad reflection + sparkles). */
  setSparkleStrength(s: number): void {
    this.sparkleUniforms.uSparkleStrength.value = s;
  }

  private elapsed = 0;

  constructor(scene: THREE.Scene, params: WaveOceanParams) {
    this.waveZ = params.startZ;
    this.peakAmp = params.peakAmp;
    this.waveSpeed = params.waveSpeed;
    this.breakSpeed = params.breakSpeed;
    this.sigmaFront = params.sigmaFront;
    this.sigmaBack = params.sigmaBack;

    // ── Wave strip ───────────────────────────────────────────────────────
    this.geo = new THREE.PlaneGeometry(WAVE_STRIP_W, WAVE_STRIP_D, WAVE_STRIP_SEG_X, WAVE_STRIP_SEG_Z);
    this.geo.rotateX(-Math.PI / 2);

    const count = this.geo.attributes.position.count;
    const colorBuf = new Float32Array(count * 3);
    this.colAttr = new THREE.BufferAttribute(colorBuf, 3);
    this.geo.setAttribute('color', this.colAttr);
    this.posAttr = this.geo.attributes.position as THREE.BufferAttribute;
    this.normAttr = this.geo.attributes.normal as THREE.BufferAttribute;
    this.foamBuf = new Float32Array(count);

    const mat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      // Phong specular is intentionally subdued — the broad cyan highlight
      // it produces reads as a fake sun blob. Highlights now come almost
      // entirely from the injected sparkle pass below.
      specular: new THREE.Color(0x334455),
      shininess: 300,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    // Sun-glint sparkle: injected into the standard phong shader so we keep
    // lighting/shadows but add a high-frequency twinkling glint, concentrated
    // around the sun's reflected direction and strengthened at grazing angles
    // by a Fresnel term. Read-only changes to gl_FragColor before fog so
    // sparkles fade with distance.
    const sparkleUniforms = this.sparkleUniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSparkleTime     = sparkleUniforms.uSparkleTime;
      shader.uniforms.uSunDir          = sparkleUniforms.uSunDir;
      shader.uniforms.uSparkleStrength = sparkleUniforms.uSparkleStrength;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\nvarying vec3 vSparkleWorldPos;`,
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>\nvSparkleWorldPos = worldPosition.xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vSparkleWorldPos;
uniform float uSparkleTime;
uniform vec3 uSunDir;
uniform float uSparkleStrength;
float sparkleHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
// Smooth interpolated value noise — continuous, no visible cell grid.
// The grid is implicit inside the function but the bilinear smoothstep
// interpolation between corner hashes hides it completely.
float sparkleNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = sparkleHash21(i);
  float b = sparkleHash21(i + vec2(1.0, 0.0));
  float c = sparkleHash21(i + vec2(0.0, 1.0));
  float d = sparkleHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}`,
        )
        .replace(
          '#include <fog_fragment>',
          `{
  vec3 N = normalize(normal);
  vec3 V = normalize(cameraPosition - vSparkleWorldPos);
  vec3 R = reflect(-uSunDir, N);
  float vdotr   = max(0.0, dot(V, R));
  float fresnel = pow(1.0 - max(0.0, dot(V, N)), 2.0);
  vec3 sunTint  = vec3(1.0, 0.95, 0.85);

  // World coords wrapped at a long distance to keep hash precision good
  // while the surfer travels — the wrap is rarely crossed in a single
  // viewport and the underlying noise is interpolated so any boundary
  // discontinuity is a soft gradient line, not a grid of squares.
  vec2 wrapXZ = vSparkleWorldPos.xz - 1024.0 * floor(vSparkleWorldPos.xz / 1024.0);

  // (a) Broad sun-reflection band.
  float sunPath = pow(vdotr, 1.8);
  gl_FragColor.rgb += sunTint * sunPath * (0.35 + 0.65 * fresnel) * uSparkleStrength * 0.9;

  // (b) Sparkles — built from THREE multiplied octaves of continuous
  // interpolated noise. No floor()-cell hashing, no per-cell dots.
  // Multiplying noises means only the rare spots where all three peak
  // produce a bright sparkle; a sharp pow() lifts the highlights into
  // tight bright points without any grid structure.
  float sunAlignSparkle = pow(vdotr, 5.0);
  float t = uSparkleTime;
  vec2 q1 = wrapXZ * 0.8  + vec2( 0.6,  0.2) * t;
  vec2 q2 = wrapXZ * 1.7  + vec2(-0.4,  0.9) * t * 0.7;
  vec2 q3 = wrapXZ * 3.1  + vec2( 0.9, -0.5) * t * 1.3;
  float n = sparkleNoise2(q1) * sparkleNoise2(q2) * sparkleNoise2(q3);
  float sparkle = pow(max(0.0, n - 0.06), 2.2) * 60.0;
  gl_FragColor.rgb += sunTint * sparkle * sunAlignSparkle * (0.4 + 0.6 * fresnel) * uSparkleStrength * 0.2;
}
#include <fog_fragment>`,
        );
    };
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.position.z = params.startZ + WAVE_STRIP_OFFSET_Z;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    const overlayPlane = () => {
      const geo = new THREE.PlaneGeometry(WAVE_STRIP_W, WAVE_STRIP_D, WAVE_STRIP_SEG_X, WAVE_STRIP_SEG_Z);
      geo.rotateX(-Math.PI / 2);
      return geo;
    };

    // ── Surface foam overlay: tiling bubble texture, vertex-color masked ──
    this.sfGeo = overlayPlane();
    this.sfPosAttr = this.sfGeo.attributes.position as THREE.BufferAttribute;
    this.sfColAttr = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.sfGeo.setAttribute('color', this.sfColAttr);
    this.sfTex = makeSurfaceFoamTexture(params.rng);
    this.sfMat = createSurfaceFoamMaterial(this.sfTex);
    this.surfaceFoamMesh = new THREE.Mesh(this.sfGeo, this.sfMat);
    this.surfaceFoamMesh.position.z = params.startZ + WAVE_STRIP_OFFSET_Z;
    this.surfaceFoamMesh.renderOrder = 1;
    this.surfaceFoamMesh.frustumCulled = false;
    scene.add(this.surfaceFoamMesh);

    // ── Whitewater overlay: procedural shader for broken/lip/trail foam ──
    this.wwGeo = overlayPlane();
    this.wwPosAttr = this.wwGeo.attributes.position as THREE.BufferAttribute;
    this.wwMaskAttr = new THREE.BufferAttribute(new Float32Array(count), 1);
    this.wwGeo.setAttribute(WHITEWATER_ATTR, this.wwMaskAttr);
    this.wwMat = createWhitewaterMaterial(params.startZ);
    this.whitewaterMesh = new THREE.Mesh(this.wwGeo, this.wwMat);
    this.whitewaterMesh.position.z = params.startZ + WAVE_STRIP_OFFSET_Z;
    this.whitewaterMesh.renderOrder = 2;
    this.whitewaterMesh.frustumCulled = false;
    scene.add(this.whitewaterMesh);
  }

  /**
   * Advance the wave and recompute the mesh.
   * The mesh follows the surfer so the ocean never runs out, while the wave
   * crest travels through it.
   */
  update(dt: number, breakX: number, surferZ: number, surferX = 0): void {
    this.elapsed += dt;
    this.waveZ += this.waveSpeed * dt;

    const meshPosZ = surferZ + WAVE_STRIP_OFFSET_Z;
    this.mesh.position.z = meshPosZ;
    this.whitewaterMesh.position.z = meshPosZ;
    this.surfaceFoamMesh.position.z = meshPosZ;

    this.wwMat.uniforms.uTime.value = this.elapsed;
    this.wwMat.uniforms.uWaveZ.value = this.waveZ;
    this.sparkleUniforms.uSparkleTime.value = this.elapsed;

    // Scroll surface foam texture so bubbles drift with the wave (slowly,
    // per FOAM_PARALLAX) and along X with the break sweep, while cancelling
    // out the mesh's own motion with the surfer.
    const worldPerUVy = WAVE_STRIP_D / this.sfTex.repeat.y;
    const worldPerUVx = WAVE_STRIP_W / this.sfTex.repeat.x;
    this.sfTex.offset.y = mod1(FOAM_PARALLAX * this.waveZ / worldPerUVy - surferZ / worldPerUVy);
    this.sfTex.offset.x = mod1((this.breakSpeed * this.elapsed) / worldPerUVx);

    const posAttr = this.posAttr;
    const colAttr = this.colAttr;
    const waveZ   = this.waveZ;
    const foamBuf = this.foamBuf;
    const wwPos   = this.wwPosAttr;
    const wwMask  = this.wwMaskAttr;
    const sfPos   = this.sfPosAttr;
    const sfCol   = this.sfColAttr;

    // Z-band skip: outside this the wave's gaussian is <1% of amp, so we
    // flatten the water cheaply. X bounds are already handled by the strip's
    // own width (plus an edge taper below).
    const REL_BACK  = -100;
    const REL_FRONT =  60;
    const halfStripW = WAVE_STRIP_W / 2;

    // ── Global surface chop ──────────────────────────────────────────────
    // A low-amplitude noise field offsetting every vertex's Y. Sampled in
    // world coords + a slow time term so it stays put as the surfer moves
    // through it (and animates slowly on its own). Tapered by edgeFactor
    // so it doesn't bump the strip's left/right borders.
    const CHOP_SAMPLE_SCALE = 0.25;   // 1/scale = wavelength (~4m bumps)
    const CHOP_AMP          = 2;
    const CHOP_TIME_SPEED   = 0.25;
    const chopT = this.elapsed * CHOP_TIME_SPEED;

    // Extra turbulent chop, applied ONLY where the whitewater mask is on
    // (broken side / lip / trail). Higher frequency + larger amplitude +
    // faster animation so the broken section reads as agitated, turbulent
    // water rather than the same gentle chop as the rest of the surface.
    const WW_CHOP_SAMPLE_SCALE = 0.6;   // ~1.7m bumps
    const WW_CHOP_AMP          = 10;
    const WW_CHOP_TIME_SPEED   = 0.1;
    const wwChopT = this.elapsed * WW_CHOP_TIME_SPEED;

    for (let i = 0; i < posAttr.count; i++) {
      const wx = posAttr.getX(i);
      const wz = posAttr.getZ(i) + meshPosZ;
      const rel = wz - waveZ;

      // X-edge taper: smoothly drop wave height to 0 at the strip's left/right
      // borders so the wave height falls to 0 without a cliff. Shared by the
      // main wave and the background swell crests.
      const edgeDist = halfStripW - Math.abs(wx);
      const edgeFactor = Math.max(0, Math.min(1, edgeDist / WAVE_STRIP_EDGE_TAPER));

      // Per-vertex chop: small +/- offset added to the wave height. Tapered
      // by edgeFactor so the strip's left/right borders stay flat.
      // Sampled in MESH-LOCAL Z (posAttr.getZ(i), constant per vertex)
      // rather than world or wave-relative Z. World Z slides at surfer
      // speed; wave-relative Z slides at (surfer - wave) speed (the
      // surfer's Z velocity from physics — pumping, turns — differs from
      // the wave's constant WAVE_SPEED). Mesh-local Z is fixed per vertex
      // so only chopT drives change, regardless of any motion.
      const posLocalZ = posAttr.getZ(i);
      const chopY = (noise3(wx * CHOP_SAMPLE_SCALE, chopT, posLocalZ * CHOP_SAMPLE_SCALE) - 0.5) * 2 * CHOP_AMP * edgeFactor;

      if (rel < REL_BACK || rel > REL_FRONT) {
        // Outside the active main-wave band: only the unbroken background
        // crests contribute height. No foam / whitewater here.
        const bgY = backgroundWaveHeight(
          wz, waveZ, wx, breakX,
          this.peakAmp, this.sigmaFront, (this.sigmaFront * 0.7 + this.sigmaBack * 0.3),
        ) * edgeFactor;
        const yFinal = bgY + chopY;
        posAttr.setY(i, yFinal);
        colAttr.setXYZ(i, COL_DEEP.r, COL_DEEP.g, COL_DEEP.b);
        foamBuf[i] = 0;
        wwPos.setY(i, yFinal + TRAIL_LIFT);
        wwMask.setX(i, 0);
        sfPos.setY(i, yFinal + TRAIL_LIFT);
        sfCol.setXYZ(i, 0, 0, 0);
        continue;
      }
      const h = waveHeightAt(wz, waveZ, wx, breakX, this.peakAmp, this.sigmaFront, this.sigmaBack) * edgeFactor;
      // hFinal is computed below, after the whitewater mask is known, so
      // we can add extra turbulent chop in broken regions.

      // ── Whitewater mask: opaque foam on broken side / lip / forward trail ──
      // Single source of truth for foam — physics balance hit-test calls the
      // same foamMaskAt(). The crest-foam component (drives normal
      // perturbation) is read back via the scratch out-param.
      const whitewater = foamMaskAt(
        wx, wz, waveZ, breakX,
        this.peakAmp, this.sigmaFront, this.sigmaBack,
        edgeFactor, _crestOut,
      );
      foamBuf[i] = _crestOut.value;   // only the crest foam drives normal perturbation

      // Extra turbulent chop in broken regions — higher frequency, taller,
      // scaled by the whitewater mask so it ramps up only where the wave
      // is actually breaking. Sampled in mesh-local Z (same reasoning as
      // the global chop above) so it never slides with any velocity.
      const wwChopY = (noise3(wx * WW_CHOP_SAMPLE_SCALE, wwChopT, posLocalZ * WW_CHOP_SAMPLE_SCALE) - 0.5) * 2 * WW_CHOP_AMP * whitewater * edgeFactor;
      const hFinal = h + chopY + wwChopY;
      posAttr.setY(i, hFinal);

      // ── Surface foam mask: subtle detail near the wave crest only ──
      // Ramps up quickly so anything above a shallow threshold gets full
      // detail; tapered down where the whitewater overlay is strong so we
      // don't double up two white layers on the broken section. A gaussian
      // Z falloff (centred on the crest) kills the foam on the gentle outer
      // slopes so the back / front shoulders read as clean water.
      const surfaceRamp = Math.min(1, h / (this.peakAmp * 0.15));
      const SURFACE_FOAM_Z_SIGMA = 12;
      const zFade = Math.exp(-(rel * rel) / (2 * SURFACE_FOAM_Z_SIGMA * SURFACE_FOAM_Z_SIGMA));
      const surfaceMask = surfaceRamp * zFade * Math.max(0, 1 - whitewater);

      vertexColor(h, _crestOut.value, _tmp);

      // Front-face translucent tint: lerp toward backlit turquoise on the
      // steep face. Strongest at mid-face (rel ≈ WAVE_SIGMA_FRONT) and on the
      // upper half of the wave; suppressed where foam takes over.
      if (rel > 0 && _crestOut.value < 0.05) {
        const faceT   = Math.min(1, rel / WAVE_SIGMA_FRONT);
        const heightT = Math.min(1, h / (this.peakAmp * 0.5));
        _tmp.lerp(COL_TRANSLUCENT, faceT * heightT * FACE_TINT_STRENGTH);
      }

      // Back-of-wave darken: dim the gentle back slope so the crest reads as
      // a divider between lit front and shaded back. Ramps up over the first
      // sigma behind the crest, then smoothly ramps back down to 0 by the
      // edge of the active band — otherwise you get a hard step where the
      // darkened back-slope meets undarkened flat water.
      if (rel < 0) {
        const backRel = -rel;
        // smoothstep ramp-up: 0 at crest, ~1 by one sigma back.
        const u = Math.max(0, Math.min(1, backRel / WAVE_SIGMA_BACK));
        const rampUp = u * u * (3 - 2 * u);
        // smoothstep ramp-down: ~1 at one sigma, 0 by REL_BACK.
        const d = Math.max(0, Math.min(1, (-REL_BACK - backRel) / (-REL_BACK - WAVE_SIGMA_BACK)));
        const rampDown = d * d * (3 - 2 * d);
        const backT = rampUp * rampDown;
        const dim = 1 - backT * BACK_DARKEN_STRENGTH;
        _tmp.r *= dim; _tmp.g *= dim; _tmp.b *= dim;
      }

      colAttr.setXYZ(i, _tmp.r, _tmp.g, _tmp.b);

      // Distance-from-surfer fade: foam at full strength close to the
      // player, smoothly attenuating with horizontal distance so the parts
      // of the wave that are visually "in the background" don't read as a
      // bright white band.
      const dx = wx - surferX;
      const dz = wz - surferZ;
      const distFromSurfer = Math.sqrt(dx * dx + dz * dz);
      // Full strength within FOAM_NEAR, gone by FOAM_FAR.
      const FOAM_NEAR = 25;
      const FOAM_FAR  = 140;
      const t = Math.max(0, Math.min(1, (distFromSurfer - FOAM_NEAR) / (FOAM_FAR - FOAM_NEAR)));
      const foamFade = 1 - t * t * (3 - 2 * t);

      // Both overlays sit at the same height just above the water surface.
      const overlayY = hFinal + TRAIL_LIFT;
      wwPos.setY(i, overlayY);
      wwMask.setX(i, whitewater * foamFade);
      sfPos.setY(i, overlayY);
      const a = surfaceMask * 0.1 * foamFade;
      sfCol.setXYZ(i, a, a, a);
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    wwPos.needsUpdate = true;
    wwMask.needsUpdate = true;
    sfPos.needsUpdate = true;
    sfCol.needsUpdate = true;

    this.geo.computeVertexNormals();

    // Perturb normals in foam regions — shimmering turbulence without extra geo.
    // Sample noise in the WAVE's frame (wz - waveZ) so the chop pattern rides
    // along with the wave at WAVE_SPEED. Sampling in world-fixed coords made
    // the pattern stream past the surfer at the surfer's speed — wrong.
    const normAttr = this.normAttr;
    const scale = FOAM_CHOP_SCALE;
    const t = this.elapsed * FOAM_CHOP_SPEED;
    const s = FOAM_CHOP_STRENGTH;
    for (let i = 0; i < normAttr.count; i++) {
      const f = foamBuf[i];
      if (f < 0.05) continue;
      const wx = posAttr.getX(i);
      const wz = posAttr.getZ(i) + meshPosZ;
      const wzWave = (wz - waveZ) * scale;
      const nxOff = (noise3(wx * scale,           wzWave,           t) - 0.5) * s * f;
      const nzOff = (noise3(wx * scale + 137.1,   wzWave - 91.7,    t) - 0.5) * s * f;
      const nx = normAttr.getX(i) + nxOff;
      const ny = normAttr.getY(i);
      const nz = normAttr.getZ(i) + nzOff;
      const invLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      normAttr.setXYZ(i, nx * invLen, ny * invLen, nz * invLen);
    }
    normAttr.needsUpdate = true;
  }

  setWireframe(on: boolean): void {
    (this.mesh.material as THREE.MeshPhongMaterial).wireframe = on;
    this.wwMat.wireframe = on;
    this.sfMat.wireframe = on;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.wwGeo.dispose();
    this.wwMat.dispose();
    this.sfGeo.dispose();
    this.sfMat.dispose();
    this.sfTex.dispose();
  }
}
