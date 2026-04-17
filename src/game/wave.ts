import * as THREE from 'three';
import {
  WAVE_AMP, WAVE_SIGMA_FRONT, WAVE_SIGMA_BACK,
  WAVE_X_DECAY, WAVE_X_SIGMA_SCALE,
  WAVE_SPEED, BREAK_SPEED, OCEAN_W, OCEAN_D,
  OCEAN_SEG_X, OCEAN_SEG_Z, OCEAN_MESH_OFFSET_Z,
  FOAM_CHOP_SCALE, FOAM_CHOP_SPEED, FOAM_CHOP_STRENGTH,
  FOAM_PARALLAX,
  TRAIL_LIFT,
} from './constants';

// ─── Wave profile ────────────────────────────────────────────────────────────

/**
 * Wave height at (worldZ, worldX).
 * - Z profile: asymmetric Gaussian centred at waveZ (steep front, gentle back).
 * - X profile: amplitude decays exponentially away from breakX toward +X;
 *   the back-slope sigma also widens further from the break.
 */
export function waveHeightAt(
  worldZ: number,
  waveZ: number,
  worldX = 0,
  breakX = 0,
): number {
  const rel = worldZ - waveZ;
  const xDist = Math.max(0, worldX - breakX);
  const amp = WAVE_AMP * Math.exp(-xDist / WAVE_X_DECAY);
  const sigmaBack = WAVE_SIGMA_BACK + xDist / WAVE_X_SIGMA_SCALE;
  const sigma = rel >= 0 ? WAVE_SIGMA_FRONT : sigmaBack;
  return amp * Math.exp(-(rel * rel) / (2 * sigma * sigma));
}

// Modulo that handles negatives correctly (JS `%` returns negative for negatives).
function mod1(x: number): number {
  const r = x - Math.floor(x);
  return r;
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

// ─── Foam overlay texture (generated once, no asset dependency) ──────────────

function makeFoamTexture(): THREE.Texture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  // Scatter 1800 soft white bubbles with varying size and opacity
  for (let i = 0; i < 1800; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 1.5 + Math.random() * 14;
    const a = 0.2 + Math.random() * 0.6;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  return tex;
}

// ─── WaveOcean ───────────────────────────────────────────────────────────────

export class WaveOcean {
  readonly mesh: THREE.Mesh;
  readonly overlayMesh: THREE.Mesh;

  /** Current world-Z position of the wave crest. */
  waveZ: number;

  private readonly geo: THREE.BufferGeometry;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly normAttr: THREE.BufferAttribute;
  private readonly foamBuf: Float32Array;

  private readonly overlayGeo: THREE.BufferGeometry;
  private readonly overlayPosAttr: THREE.BufferAttribute;
  private readonly overlayColAttr: THREE.BufferAttribute;
  private readonly foamTex: THREE.Texture;

  private elapsed = 0;

  constructor(scene: THREE.Scene, startZ: number) {
    this.waveZ = startZ;

    // ── Water mesh ───────────────────────────────────────────────────────
    this.geo = new THREE.PlaneGeometry(OCEAN_W, OCEAN_D, OCEAN_SEG_X, OCEAN_SEG_Z);
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
    this.mesh.position.z = startZ + OCEAN_MESH_OFFSET_Z;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    // ── Foam overlay mesh (same topology, drawn above water) ─────────────
    this.overlayGeo = new THREE.PlaneGeometry(OCEAN_W, OCEAN_D, OCEAN_SEG_X, OCEAN_SEG_Z);
    this.overlayGeo.rotateX(-Math.PI / 2);
    this.overlayPosAttr = this.overlayGeo.attributes.position as THREE.BufferAttribute;
    const overlayColorBuf = new Float32Array(count * 3);
    this.overlayColAttr = new THREE.BufferAttribute(overlayColorBuf, 3);
    this.overlayGeo.setAttribute('color', this.overlayColAttr);

    this.foamTex = makeFoamTexture();

    const overlayMat = new THREE.MeshBasicMaterial({
      map: this.foamTex,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.overlayMesh = new THREE.Mesh(this.overlayGeo, overlayMat);
    this.overlayMesh.position.z = startZ + OCEAN_MESH_OFFSET_Z;
    this.overlayMesh.renderOrder = 1;   // draw after water, before board (renderOrder=2)
    this.overlayMesh.frustumCulled = false;
    scene.add(this.overlayMesh);
  }

  /**
   * Advance the wave and recompute the mesh.
   * The mesh follows the surfer so the ocean never runs out, while the wave
   * crest travels through it.
   */
  update(dt: number, breakX: number, surferZ: number, surferX: number): void {
    this.elapsed += dt;
    this.waveZ += WAVE_SPEED * dt;

    const meshPosZ = surferZ + OCEAN_MESH_OFFSET_Z;
    this.mesh.position.z = meshPosZ;
    this.overlayMesh.position.z = meshPosZ;

    // Foam texture scroll: subtract surfer position so the on-screen scroll
    // rate stays constant regardless of surfer speed. Without this, outrunning
    // the wave made the texture appear to roll backward.
    const worldPerUVy = OCEAN_D / this.foamTex.repeat.y;
    const worldPerUVx = OCEAN_W / this.foamTex.repeat.x;
    this.foamTex.offset.y = mod1(FOAM_PARALLAX * this.waveZ / worldPerUVy - surferZ / worldPerUVy);
    this.foamTex.offset.x = mod1((BREAK_SPEED * this.elapsed) / worldPerUVx - surferX / worldPerUVx);

    const posAttr = this.posAttr;
    const colAttr = this.colAttr;
    const waveZ   = this.waveZ;
    const foamBuf = this.foamBuf;
    const overlayPos = this.overlayPosAttr;
    const overlayCol = this.overlayColAttr;

    for (let i = 0; i < posAttr.count; i++) {
      const wx = posAttr.getX(i);
      const wz = posAttr.getZ(i) + meshPosZ;

      // Foam: full whitewater to the left of breakX, clean face to the right
      const foamDist = breakX - wx;
      const foam = Math.max(0, Math.min(1, foamDist / 4));
      foamBuf[i] = foam;

      const h = waveHeightAt(wz, waveZ, wx, breakX);// * (1 - foam * 0.55);
      posAttr.setY(i, h);

      vertexColor(h, foam, _tmp);
      colAttr.setXYZ(i, _tmp.r, _tmp.g, _tmp.b);

      // Foam overlay: same XZ, slightly above water; grayscale vertex color
      // acts as a per-vertex foam mask multiplied with the bubble texture.
      overlayPos.setY(i, h + TRAIL_LIFT);
      const a = foam * 0.95;
      overlayCol.setXYZ(i, a, a, a);
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    overlayPos.needsUpdate = true;
    overlayCol.needsUpdate = true;

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

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.overlayGeo.dispose();
    (this.overlayMesh.material as THREE.Material).dispose();
    this.foamTex.dispose();
  }
}
