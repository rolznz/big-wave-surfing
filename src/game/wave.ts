import * as THREE from 'three';
import {
  WAVE_AMP, WAVE_SPEED, OCEAN_W, OCEAN_D,
  OCEAN_SEG_X, OCEAN_SEG_Z, OCEAN_MESH_OFFSET_Z,
} from './constants';

// ─── Wave profile ────────────────────────────────────────────────────────────

/**
 * Returns wave height at a given world-Z position.
 * Asymmetric Gaussian: steep face (+Z side), gentle back (-Z side).
 */
export function waveHeightAt(worldZ: number, waveZ: number): number {
  const rel = worldZ - waveZ;
  const sigma = rel >= 0 ? 1.8 : 5.0;
  return WAVE_AMP * Math.exp(-(rel * rel) / (2 * sigma * sigma));
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
  readonly curlMesh: THREE.Mesh;

  /** Current world-Z position of the wave crest. */
  waveZ: number;

  private readonly geo: THREE.BufferGeometry;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly curlOrigHalfLen: number;

  constructor(scene: THREE.Scene, startZ: number) {
    this.waveZ = startZ;

    // ── Ocean plane ──────────────────────────────────────────────────────────
    // PlaneGeometry in XY; bake a -90° X rotation so attributes are in world
    // space: getX→worldX, getZ→worldZ, getY→height (initially 0).
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
    // Offset mesh so geometry covers world Z ≈ [-56, +36]
    this.mesh.position.z = OCEAN_MESH_OFFSET_Z;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    // ── Curl cylinder (breaking lip) ─────────────────────────────────────────
    // Cylinder's length axis = local Y; after rotation.z = PI/2, length maps to -X.
    this.curlOrigHalfLen = OCEAN_W / 2;
    const curlGeo = new THREE.CylinderGeometry(0.55, 0.85, OCEAN_W, 10, 1);
    const curlMat = new THREE.MeshPhongMaterial({
      color: 0xddf5ff,
      opacity: 0.92,
      transparent: true,
    });
    this.curlMesh = new THREE.Mesh(curlGeo, curlMat);
    this.curlMesh.rotation.z = Math.PI / 2;
    this.curlMesh.castShadow = true;
    scene.add(this.curlMesh);
  }

  update(dt: number, breakX: number): void {
    this.waveZ += WAVE_SPEED * dt;

    const posAttr = this.posAttr;
    const colAttr = this.colAttr;
    const meshOffZ = OCEAN_MESH_OFFSET_Z;
    const waveZ = this.waveZ;

    for (let i = 0; i < posAttr.count; i++) {
      const wx = posAttr.getX(i);
      // After baked rotateX, getZ gives local-Z = world-Z minus mesh offset
      const wz = posAttr.getZ(i) + meshOffZ;

      // Foam factor: 0 = clean water, 1 = full whitewater
      const foamDist = breakX - wx;
      const foam = Math.max(0, Math.min(1, foamDist / 4));

      const h = waveHeightAt(wz, waveZ) * (1 - foam * 0.55);
      posAttr.setY(i, h);

      vertexColor(h, foam, _tmp);
      colAttr.setXYZ(i, _tmp.r, _tmp.g, _tmp.b);
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.geo.computeVertexNormals();

    // ── Reposition curl to span the unbroken section of the crest ────────────
    const rightEdge = OCEAN_W / 2;
    const unbrokenWidth = Math.max(0.5, rightEdge - breakX);
    const curlScaleY = unbrokenWidth / (this.curlOrigHalfLen * 2);
    const curlCenterX = breakX + unbrokenWidth / 2;

    this.curlMesh.scale.y = curlScaleY;
    this.curlMesh.position.set(curlCenterX, WAVE_AMP + 0.45, waveZ + 0.6);
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    (this.curlMesh.geometry as THREE.BufferGeometry).dispose();
    (this.curlMesh.material as THREE.Material).dispose();
  }
}
