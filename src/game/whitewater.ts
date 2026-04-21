// ─── Whitewater ──────────────────────────────────────────────────────────────
// Opaque, churning foam for the BROKEN section of the wave:
//   · crest foam on the left (broken) side of the break line
//   · bright "lip" rope right at the active break line
//   · fading forward trail that spreads onto flat water ahead of the wave
//
// Rendered as a separate overlay mesh sharing topology with the water mesh.
// Per-vertex `aFoam` attribute drives opacity (computed in WaveOcean.update);
// a procedural value-noise shader turns that mask into anisotropic streaks.
//
// Distinct from `surfaceFoam.ts`, which paints subtle detail across the whole
// wave face regardless of break state.

import * as THREE from 'three';

export const WHITEWATER_ATTR = 'aFoam';

const VERT = `
  attribute float aFoam;
  varying float vFoam;
  varying vec2 vWaveUV;
  uniform float uWaveZ;
  void main() {
    vFoam = aFoam;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWaveUV = vec2(worldPos.x, worldPos.z - uWaveZ);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FRAG = `
  precision mediump float;
  varying float vFoam;
  varying vec2 vWaveUV;
  uniform float uTime;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    if (vFoam <= 0.01) discard;

    // Two noise layers with different anisotropy and scroll rates. Stretching
    // along wave-frame-y (direction of wave travel) gives streaks pointing
    // forward; scrolling in -y shifts the pattern with the rolling foam.
    vec2 p1 = vec2(vWaveUV.x * 0.35, vWaveUV.y * 0.08 - uTime * 0.9);
    vec2 p2 = vec2(vWaveUV.x * 0.12 + uTime * 0.15, vWaveUV.y * 0.25 - uTime * 0.5);
    float n = noise2(p1) * 0.55 + noise2(p2) * 0.45;

    // Marble: where the mask is weak, only the noise crests punch through as
    // streaks; where it's strong (crest/lip), the surface reads as solid white
    // with subtle variation. pow() lifts the mid-range so crest foam is opaque.
    float foam = clamp(vFoam - 0.35 + n * 0.7, 0.0, 1.0);
    foam = pow(foam, 0.7);

    vec3 color = mix(vec3(0.85, 0.93, 0.98), vec3(1.0), smoothstep(0.3, 0.9, foam));
    gl_FragColor = vec4(color, foam);
  }
`;

export interface WhitewaterUniforms {
  uTime:  { value: number };
  uWaveZ: { value: number };
}

export function createWhitewaterMaterial(startZ: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:  { value: 0 },
      uWaveZ: { value: startZ },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}
