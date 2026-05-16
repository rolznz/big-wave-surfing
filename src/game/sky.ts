import * as THREE from 'three';

const HORIZON = new THREE.Color(0xdbeef7);
const MID = new THREE.Color(0x7cc3ec);
const ZENITH = new THREE.Color(0x2f6fb8);
const CLOUD = new THREE.Color(0xffffff);

export interface Sky {
  mesh: THREE.Mesh;
  update: (centerPos: THREE.Vector3, dt: number) => void;
  dispose: () => void;
}

export function createSky(): Sky {
  const geo = new THREE.SphereGeometry(100, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: HORIZON },
      uMid: { value: MID },
      uZenith: { value: ZENITH },
      uCloud: { value: CLOUD },
      uExponent: { value: 0.9 },
      uTime: { value: 0 },
      // Cloud shape & coverage. Tweak in code if needed.
      uCloudScale:    { value: 1.8 },  // higher = smaller, denser clouds
      uCloudThresh:   { value: 0.50 }, // higher = fewer clouds
      uCloudSoftness: { value: 0.25 }, // softness of edges
      uCloudOpacity:  { value: 0.85 }, // max whiteness
      uCloudDrift:    { value: 0.015 },// scroll speed
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(wp.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorldDir;
      uniform vec3 uHorizon;
      uniform vec3 uMid;
      uniform vec3 uZenith;
      uniform vec3 uCloud;
      uniform float uExponent;
      uniform float uTime;
      uniform float uCloudScale;
      uniform float uCloudThresh;
      uniform float uCloudSoftness;
      uniform float uCloudOpacity;
      uniform float uCloudDrift;

      // 2D value noise (cheap, smooth interpolation).
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
      // 5-octave FBM — gives wispy cloud shapes.
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          v += a * noise2(p);
          p *= 2.0;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        // ── Sky gradient (driven by world-up direction) ─────────────────────
        float h = clamp(vWorldDir.y, -0.1, 1.0);
        float t = pow(max(h, 0.0), uExponent);
        vec3 lower = mix(uHorizon, uMid, smoothstep(0.0, 0.45, t));
        vec3 col   = mix(lower,   uZenith, smoothstep(0.45, 1.0, t));

        // ── Clouds (procedural FBM on the sky dome) ────────────────────────
        if (vWorldDir.y > 0.0) {
          // Project view direction to a 2D "looking up at a cloud sheet" UV.
          // Dividing by y de-warps the projection: small y → big UV → wider
          // clouds near the horizon (foreshortening, looks natural).
          vec2 uv = vWorldDir.xz / max(vWorldDir.y, 0.08);
          uv = uv * uCloudScale + vec2(uTime * uCloudDrift, uTime * uCloudDrift * 0.6);
          float n = fbm(uv);
          // Threshold + soft edges.
          float cloud = smoothstep(uCloudThresh, uCloudThresh + uCloudSoftness, n);
          // Fade out near horizon so clouds don't punch through the haze band.
          cloud *= smoothstep(0.05, 0.35, vWorldDir.y);
          col = mix(col, uCloud, cloud * uCloudOpacity);
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  return {
    mesh,
    update: (centerPos, dt) => {
      mesh.position.copy(centerPos);
      mat.uniforms.uTime.value += dt;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}
