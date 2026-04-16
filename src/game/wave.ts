import * as THREE from 'three';
import {
  WAVE_AMP, WAVE_SIGMA_FRONT, WAVE_SIGMA_BACK,
  WAVE_X_DECAY, WAVE_X_SIGMA_SCALE,
  WAVE_SPEED, OCEAN_W, OCEAN_D,
  OCEAN_SEG_X, OCEAN_SEG_Z, OCEAN_MESH_OFFSET_Z,
} from './constants';

// ─── Wave profile ────────────────────────────────────────────────────────────

/**
 * Wave height at (worldZ, worldX).
 * - Z profile: asymmetric Gaussian centred at waveZ (steep front, gentle back).
 * - X profile: amplitude decays exponentially away from breakX toward +X;
 *   the back-slope sigma also widens, making the wave gentler and deeper
 *   further from the breaking section.
 */
export function waveHeightAt(
  worldZ: number,
  waveZ: number,
  worldX = 0,
  breakX = 0,
): number {
  const rel = worldZ - waveZ;

  // Distance ahead of the break front (0 on the foam/broken side)
  const xDist = Math.max(0, worldX - breakX);

  // Amplitude falls off away from the break
  const amp = WAVE_AMP * Math.exp(-xDist / WAVE_X_DECAY);

  // Back-slope widens further from the break (gentler, deeper swell)
  const sigmaBack = WAVE_SIGMA_BACK + xDist / WAVE_X_SIGMA_SCALE;
  const sigma = rel >= 0 ? WAVE_SIGMA_FRONT : sigmaBack;

  return amp * Math.exp(-(rel * rel) / (2 * sigma * sigma));
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

// ─── WaveOcean class ──────────────────────────────────────────────────────────

export class WaveOcean {
  readonly mesh: THREE.Mesh;

  /** Current world-Z position of the wave crest. */
  waveZ: number;

  private readonly geo: THREE.BufferGeometry;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;

  constructor(scene: THREE.Scene, startZ: number) {
    this.waveZ = startZ;

    // PlaneGeometry in XY; bake a -90° X rotation so buffer attributes are in
    // world space: getX→worldX, getZ→worldZ, getY→height.
    this.geo = new THREE.PlaneGeometry(OCEAN_W, OCEAN_D, OCEAN_SEG_X, OCEAN_SEG_Z);
    this.geo.rotateX(-Math.PI / 2);

    const count = this.geo.attributes.position.count;
    const colorBuf = new Float32Array(count * 3);
    this.colAttr = new THREE.BufferAttribute(colorBuf, 3);
    this.geo.setAttribute('color', this.colAttr);
    this.posAttr = this.geo.attributes.position as THREE.BufferAttribute;

    const mat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      specular: new THREE.Color(0x99eeff),
      shininess: 120,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.position.z = startZ + OCEAN_MESH_OFFSET_Z;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  /**
   * Advance the wave and recompute the mesh.
   * surferZ is used to keep the mesh centred on the player so the ocean never
   * runs out, while the wave crest travels independently — giving the visual
   * of a wave moving through calm water.
   */
  update(dt: number, breakX: number, surferZ: number): void {
    this.waveZ += WAVE_SPEED * dt;

    // Mesh follows the surfer, not the wave crest — the wave shape appears to
    // move through the stationary-looking water around the player.
    this.mesh.position.z = surferZ + OCEAN_MESH_OFFSET_Z;

    const posAttr = this.posAttr;
    const colAttr = this.colAttr;
    const waveZ   = this.waveZ;
    const meshPosZ = this.mesh.position.z;

    for (let i = 0; i < posAttr.count; i++) {
      const wx = posAttr.getX(i);
      const wz = posAttr.getZ(i) + meshPosZ;

      // Foam: full whitewater to the left of breakX, clean face to the right
      const foamDist = breakX - wx;
      const foam = Math.max(0, Math.min(1, foamDist / 4));

      const h = waveHeightAt(wz, waveZ, wx, breakX) * (1 - foam * 0.55);
      posAttr.setY(i, h);

      vertexColor(h, foam, _tmp);
      colAttr.setXYZ(i, _tmp.r, _tmp.g, _tmp.b);
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
