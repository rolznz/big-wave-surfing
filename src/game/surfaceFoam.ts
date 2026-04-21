// ─── Surface foam ────────────────────────────────────────────────────────────
// Subtle bubble detail painted across the ENTIRE wave face — the previous
// "foam texture": thousands of soft-white radial blobs on a tiling canvas,
// additively blended onto the water. Gives the unbroken face texture so it
// doesn't read as a blurry gradient.
//
// Per-vertex `color` attribute (grayscale r=g=b) acts as the opacity mask;
// WaveOcean drives it from wave height so bubbles only appear where the face
// rises above flat water. Where whitewater is opaque (broken/lip/trail), the
// surface-foam mask fades out so we don't double up two white layers.
//
// Distinct from `whitewater.ts`, which paints the broken section + lip +
// forward trail with opaque churning foam.

import * as THREE from 'three';
import type { Rng } from './rng';

/**
 * Generate the tiling bubble texture once per WaveOcean.
 * 1800 soft-white radial gradients scattered over a 512×512 canvas, with each
 * bubble also drawn at its 8 wrap-neighbour positions so the texture tiles
 * seamlessly under RepeatWrapping.
 */
export function makeSurfaceFoamTexture(rng: Rng): THREE.Texture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 1800; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 1.5 + rng() * 14;
    const a = 0.2 + rng() * 0.6;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = x + dx * size;
        const cy = y + dy * size;
        if (cx + r < 0 || cx - r > size || cy + r < 0 || cy - r > size) continue;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `rgba(255,255,255,${a})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  return tex;
}

export function createSurfaceFoamMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: texture,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}
