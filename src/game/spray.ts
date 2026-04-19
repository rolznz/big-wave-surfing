import * as THREE from 'three';
import { waveHeightAt } from './wave';
import {
  SPRAY_MAX_PARTICLES, SPRAY_SPAWN_PER_SEC, SPRAY_LIFETIME,
} from './constants';
import type { Rng } from './rng';

function makeSprayTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0,    'rgba(255,255,255,0.95)');
  grad.addColorStop(0.4,  'rgba(255,255,255,0.35)');
  grad.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

export interface SpraySystem {
  readonly mesh: THREE.Points;
  update(dt: number, breakX: number, waveZ: number, surferZ: number): void;
  dispose(): void;
}

export function createSpray(scene: THREE.Scene, rng: Rng, peakAmp: number): SpraySystem {
  const N = SPRAY_MAX_PARTICLES;

  const positions = new Float32Array(N * 3);
  const colors    = new Float32Array(N * 3);
  const sizes     = new Float32Array(N);
  const velocities = new Float32Array(N * 3);
  const ages      = new Float32Array(N);
  const alive     = new Uint8Array(N);

  // Start every slot "dead" so nothing shows until spawned
  for (let i = 0; i < N; i++) {
    positions[i * 3 + 1] = -1000;  // park below the world
    sizes[i] = 0;
  }

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  const sizeAttr = new THREE.BufferAttribute(sizes, 1);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  sizeAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  geo.setAttribute('size', sizeAttr);

  const tex = makeSprayTexture();

  // Use ShaderMaterial so we can control per-particle size in world units.
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map:       { value: tex },
      pixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: `
      attribute float size;
      varying vec3 vColor;
      uniform float pixelRatio;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * pixelRatio * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      varying vec3 vColor;
      void main() {
        vec4 t = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(vColor * t.rgb, t.a);
        if (gl_FragColor.a < 0.02) discard;
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  scene.add(points);

  let spawnAccum = 0;
  let nextSearchSlot = 0;

  function findDeadSlot(): number {
    for (let tries = 0; tries < N; tries++) {
      const i = (nextSearchSlot + tries) % N;
      if (!alive[i]) {
        nextSearchSlot = (i + 1) % N;
        return i;
      }
    }
    return -1;
  }

  function spawn(breakX: number, waveZ: number, surferZ: number) {
    const i = findDeadSlot();
    if (i < 0) return;
    alive[i] = 1;
    ages[i] = 0;

    // Spawn just to the foam side of the break line (a few units left), at
    // roughly crest Z with jitter so emissions spread along the breaking lip.
    const x = breakX - 2 - rng() * 6;
    const zJitter = (rng() - 0.5) * 40;
    const z = waveZ + zJitter;

    // Sample wave height near this point so the spray launches from the surface
    const y = waveHeightAt(z, waveZ, x, breakX, peakAmp);

    positions[i * 3    ] = x;
    positions[i * 3 + 1] = y + 0.5;
    positions[i * 3 + 2] = z;

    // Initial velocity: strong upward, tilted back (+Z) and slightly into the
    // wave face (+X) — sprays come off the lip, not the flat foam.
    const speed = 6 + rng() * 6;
    const angle = (rng() - 0.5) * 0.6;
    velocities[i * 3    ] = Math.sin(angle) * speed + 1.5;
    velocities[i * 3 + 1] = speed * (0.8 + rng() * 0.4);
    velocities[i * 3 + 2] = Math.cos(angle) * speed + 4;

    sizes[i] = 1.5 + rng() * 2.5;
    colors[i * 3]     = 1;
    colors[i * 3 + 1] = 1;
    colors[i * 3 + 2] = 1;

    // Distance from surfer should not matter for emission, but we avoid
    // emitting far behind the surfer where they won't be seen.
    if (z < surferZ - 60) alive[i] = 0;
  }

  const GRAVITY = 9;

  return {
    mesh: points,
    update(dt, breakX, waveZ, surferZ) {
      // Spawn rate (capped so we can't overflow the pool in one frame)
      spawnAccum += SPRAY_SPAWN_PER_SEC * dt;
      let toSpawn = Math.min(Math.floor(spawnAccum), N);
      spawnAccum -= toSpawn;
      while (toSpawn-- > 0) spawn(breakX, waveZ, surferZ);

      // Simulate + write buffers
      for (let i = 0; i < N; i++) {
        if (!alive[i]) continue;
        const age = ages[i] + dt;
        if (age >= SPRAY_LIFETIME) {
          alive[i] = 0;
          sizes[i] = 0;
          positions[i * 3 + 1] = -1000;
          continue;
        }
        ages[i] = age;

        // Integrate
        velocities[i * 3 + 1] -= GRAVITY * dt;
        positions[i * 3    ] += velocities[i * 3    ] * dt;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;

        // Fade brightness over lifetime
        const fade = 1 - age / SPRAY_LIFETIME;
        const b = fade;
        colors[i * 3    ] = b;
        colors[i * 3 + 1] = b;
        colors[i * 3 + 2] = b;
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
