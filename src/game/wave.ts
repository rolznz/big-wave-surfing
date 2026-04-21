import * as THREE from 'three';
import {
  WAVE_AMP, WAVE_SIGMA_FRONT, WAVE_SIGMA_BACK,
  WAVE_X_DECAY, WAVE_X_BROKEN_DECAY, WAVE_X_SIGMA_SCALE,
  WAVE_PEAK_AHEAD_X,
  WAVE_STRIP_W, WAVE_STRIP_D, WAVE_STRIP_SEG_X, WAVE_STRIP_SEG_Z,
  WAVE_STRIP_OFFSET_Z, WAVE_STRIP_EDGE_TAPER,
  FLAT_OCEAN_W, FLAT_OCEAN_D, FLAT_OCEAN_Y,
  FOAM_CHOP_SCALE, FOAM_CHOP_SPEED, FOAM_CHOP_STRENGTH,
  FOAM_HEIGHT_FRAC, FOAM_PARALLAX,
  TRAIL_LIFT,
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
): number {
  const rel = worldZ - waveZ;
  const peakX = breakX + WAVE_PEAK_AHEAD_X;
  const xDistClean  = Math.max(0, worldX - peakX);
  const xDistBroken = Math.max(0, peakX - worldX);
  const amp = peakAmp
    * Math.exp(-xDistClean  / WAVE_X_DECAY)
    * Math.exp(-xDistBroken / WAVE_X_BROKEN_DECAY);
  const sigmaBack = WAVE_SIGMA_BACK + xDistClean / WAVE_X_SIGMA_SCALE;
  const sigma = rel >= 0 ? WAVE_SIGMA_FRONT : sigmaBack;
  return amp * Math.exp(-(rel * rel) / (2 * sigma * sigma));
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

// ─── Vertex colour helpers ────────────────────────────────────────────────────

const COL_DEEP  = new THREE.Color(0x00304a);
const COL_FACE  = new THREE.Color(0x0077aa);
const COL_CREST = new THREE.Color(0x00ccff);
const COL_FOAM  = new THREE.Color(0xddf5ff);
const _tmp = new THREE.Color();

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
  readonly flatMesh: THREE.Mesh;

  /** Current world-Z position of the wave crest. */
  waveZ: number;

  readonly peakAmp: number;
  readonly waveSpeed: number;
  readonly breakSpeed: number;

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

  private readonly flatGeo: THREE.BufferGeometry;

  private elapsed = 0;

  constructor(scene: THREE.Scene, params: WaveOceanParams) {
    this.waveZ = params.startZ;
    this.peakAmp = params.peakAmp;
    this.waveSpeed = params.waveSpeed;
    this.breakSpeed = params.breakSpeed;

    // ── Flat base plane ──────────────────────────────────────────────────
    // Huge 4-vertex quad sitting just above y=0 to fill the horizon. The
    // wave strip only needs to cover the active wave band; flat water
    // everywhere else comes from this plane for free.
    this.flatGeo = new THREE.PlaneGeometry(FLAT_OCEAN_W, FLAT_OCEAN_D, 1, 1);
    this.flatGeo.rotateX(-Math.PI / 2);
    const flatMat = new THREE.MeshPhongMaterial({
      color: COL_DEEP,
      specular: new THREE.Color(0x99eeff),
      shininess: 120,
    });
    this.flatMesh = new THREE.Mesh(this.flatGeo, flatMat);
    this.flatMesh.position.y = FLAT_OCEAN_Y;
    this.flatMesh.renderOrder = -1;
    this.flatMesh.receiveShadow = true;
    scene.add(this.flatMesh);

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
      specular: new THREE.Color(0x99eeff),
      shininess: 120,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
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
  update(dt: number, breakX: number, surferZ: number, surferX: number): void {
    this.elapsed += dt;
    this.waveZ += this.waveSpeed * dt;

    const meshPosZ = surferZ + WAVE_STRIP_OFFSET_Z;
    this.mesh.position.z = meshPosZ;
    this.whitewaterMesh.position.z = meshPosZ;
    this.surfaceFoamMesh.position.z = meshPosZ;

    // Flat base plane follows the surfer so its edges stay fog-occluded no
    // matter how far the surfer travels.
    this.flatMesh.position.x = surferX;
    this.flatMesh.position.z = surferZ;

    this.wwMat.uniforms.uTime.value = this.elapsed;
    this.wwMat.uniforms.uWaveZ.value = this.waveZ;

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

    for (let i = 0; i < posAttr.count; i++) {
      const wx = posAttr.getX(i);
      const wz = posAttr.getZ(i) + meshPosZ;
      const rel = wz - waveZ;

      if (rel < REL_BACK || rel > REL_FRONT) {
        // Flat water — cheap write path.
        posAttr.setY(i, 0);
        colAttr.setXYZ(i, COL_DEEP.r, COL_DEEP.g, COL_DEEP.b);
        foamBuf[i] = 0;
        wwPos.setY(i, TRAIL_LIFT);
        wwMask.setX(i, 0);
        sfPos.setY(i, TRAIL_LIFT);
        sfCol.setXYZ(i, 0, 0, 0);
        continue;
      }

      // X-edge taper: smoothly drop wave height to 0 at the strip's left/right
      // borders so the wave blends into the flat base plane without a cliff.
      const edgeDist = halfStripW - Math.abs(wx);
      const edgeFactor = Math.max(0, Math.min(1, edgeDist / WAVE_STRIP_EDGE_TAPER));
      const h = waveHeightAt(wz, waveZ, wx, breakX, this.peakAmp) * edgeFactor;
      posAttr.setY(i, h);

      // ── Whitewater mask: opaque foam on broken side / lip / forward trail ──
      const heightFactor = Math.min(1, h / (this.peakAmp * FOAM_HEIGHT_FRAC));

      const foamDist = breakX - wx;                         // >0 on broken side
      const foamX = Math.max(0, Math.min(1, foamDist / 4));
      const crestFoam = foamX * heightFactor;

      const lipDist = Math.abs(wx - breakX);
      const lipMask = Math.max(0, 1 - lipDist / 3) * heightFactor;

      const trailX = Math.max(0, Math.min(1, foamDist / 15));
      const trailZFront = Math.max(0, Math.min(1, 1 - rel / 25));
      const trailZBack  = Math.max(0, Math.min(1, (rel + 4) / 4));
      const trailMask = trailX * trailZFront * trailZBack;

      const whitewater = Math.max(crestFoam, lipMask * 1.4, trailMask * 0.85);
      foamBuf[i] = crestFoam;   // only the crest foam drives normal perturbation

      // ── Surface foam mask: subtle detail wherever there's a wave face ──
      // Ramps up quickly so anything above a shallow threshold gets full
      // detail; tapered down where the whitewater overlay is strong so we
      // don't double up two white layers on the broken section.
      const surfaceRamp = Math.min(1, h / (this.peakAmp * 0.15));
      const surfaceMask = surfaceRamp * Math.max(0, 1 - whitewater);

      vertexColor(h, crestFoam, _tmp);
      colAttr.setXYZ(i, _tmp.r, _tmp.g, _tmp.b);

      // Both overlays sit at the same height just above the water surface.
      const overlayY = h + TRAIL_LIFT;
      wwPos.setY(i, overlayY);
      wwMask.setX(i, whitewater);
      sfPos.setY(i, overlayY);
      const a = surfaceMask * 0.1;
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
    (this.flatMesh.material as THREE.MeshPhongMaterial).wireframe = on;
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
    this.flatGeo.dispose();
    (this.flatMesh.material as THREE.Material).dispose();
  }
}
