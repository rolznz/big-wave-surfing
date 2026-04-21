# Follow-up: realistic water

## What this is about

The current water is a solid-colour `MeshPhongMaterial` on the wave strip
and an identical material on the flat base plane. It lights fine but reads
as a painted surface — not as a medium you can see into. In reference
photos the same wave shows:

1. **Depth-based colour** — clear cyan on the thin shoulder where light
   passes through the face, deep navy where the water is thick. The wave
   is a volume, not a skin.
2. **Backlit translucency** — near the lip the sun shines *through* the
   water, producing a bright turquoise band just under the crest.
3. **Refraction** — anything underwater (seafloor, the surfer's
   submerged board) appears offset and wobbling through the surface.
4. **Reflection** — sky, clouds, the horizon show up on flat water and on
   the wave's back slope; a moving crest distorts them.

A quick `onBeforeCompile` fresnel-mix was attempted and didn't read well —
it just tinted the face a uniform pale colour because there is nothing
*behind* the water for the fresnel to reveal. The illusion breaks without
something actually visible through the surface.

## Hard constraint: wave strip and flat ocean must match

Whatever technique we pick **must apply identically to the wave strip
and the `FLAT_OCEAN` base plane**, with no visible seam between them.
This is why the fresnel attempt was undone: it tinted the wave strip's
edges pale cyan but the flat plane stayed solid blue, so the strip's
outline became visible as a coloured rim floating on the sea.

Practical implication: the new water shader lives in one file and is
used by both meshes (same uniforms, same lighting, same fresnel /
depth / reflection logic). Parameters that depend on geometry (edge
taper, crest band, etc.) must degrade to a flat-water result when the
vertex is at y≈0, so the shader produces continuous output across the
strip border. Any effect that can only be computed on the wave strip
(because it needs wave-local inputs like `rel`, `breakX`) must be
masked to zero well inside the strip's edge.

## Why it's a bigger change

Each of the four effects above is really a separate pass:

- **Depth colour** needs the scene's depth buffer so the water fragment
  knows how far to the seafloor it is. That means rendering opaque
  geometry to a depth target, then sampling it when shading water.
- **Backlit translucency** needs the wave's *thickness* along the view
  ray — approximated from geometry thickness (a back-face pass) or
  faked from normal.y vs. light direction.
- **Refraction** needs a copy of the framebuffer (the scene rendered
  without the water) to sample and distort.
- **Reflection** needs either a second camera render (cheapest: a
  planar reflection camera flipped across y=0) or an environment map.

So the architecture becomes: render opaque scene → copy colour + depth
to render targets → render water in a separate pass that samples both
targets. That's a meaningful refactor of the main loop.

## Sketch of a solution

Three staged levels of ambition, cheapest first. Pick a stopping point.

### Stage 1 — Depth fog + sky reflection (no extra render targets)

This is the cheapest credible step and the recommended starting point.

- Replace the water meshes' materials with a custom `ShaderMaterial` (or
  keep Phong + `onBeforeCompile`) that:
  - Uses `gl_FragCoord` + the scene's depth texture to compute
    water-column thickness under each pixel, tinting from shallow cyan
    to deep navy. Requires enabling `renderer.info.autoClear = true`
    with a two-pass render, or using `THREE.WebGLRenderTarget` with
    `depthTexture`.
  - Samples a static gradient (or cube map) for sky reflection,
    modulated by fresnel — looks convincing on the flat plane and
    on the wave's back slope.
  - Adds a `smoothstep(h, crest, crest+ε)` translucent band near the
    lip, tinted toward a bright turquoise — cheap backlight fake.
- Requires a seafloor plane at y ≈ -5 to -10 so the depth buffer has
  something to measure against. Can be unlit + vertex-coloured dark
  blue/green; invisible through deep water, faintly visible through
  shallow.

Cost: one extra render target, one seafloor mesh, ~40 lines of shader.
No change to physics/camera/gameplay.

### Stage 2 — Refraction

Add a full-screen grab of the opaque scene (`WebGLRenderTarget` with
colour + depth), sample it in the water shader with a UV offset driven
by the surface normal's xz components. Scales the "see-through" feel
from faked-by-gradient to actually showing the displaced world
underneath.

Cost: one more render target (colour), ~20 lines of shader, one extra
full-screen sample per water fragment. Some GPU cost but still mobile-
viable at a modest resolution.

### Stage 3 — Planar reflection

Second camera mirrored across y=0, rendering the sky/horizon/far
obstacles into a texture. Sampled by the water shader with fresnel
weight. This is where flat water finally reads as water instead of as a
coloured quad.

Cost: a full extra scene render per frame at half resolution — the
first thing that actually hurts on mobile. Ship with a toggle.

## Recommendation

Start with **Stage 1**. It's the one that moves the needle from "painted
blue" to "volume of water" and it keeps the render pipeline simple —
one extra render target + one seafloor mesh. Only go to Stage 2 if the
thin shoulder still reads flat after Stage 1; Stage 3 is a nice-to-have
for screenshots but not worth the mobile budget unless we're already
comfortable on perf.

## Files that would change (Stage 1)

- `src/game/createScene.ts` — add a seafloor mesh; possibly swap to a
  two-pass render in the main loop helper.
- `src/game/loop.ts` — render opaque scene to a target first, then
  water, then overlays; manage target resize on viewport changes.
- `src/game/wave.ts` — replace the wave strip + flat plane materials
  with the new depth-aware water shader (shared between them).
- `src/game/water.ts` (new) — the shader material + uniforms, kept out
  of wave.ts so the geometry code stays focused.

## Optimization: shrink the wave strip back once the flat ocean matches

The wave strip is currently oversized along Z to hide the visual
mismatch between it and the flat base plane — the strip renders nicer
water (vertex-coloured, foam-masked, normal-perturbed) than the plane,
so the more of the near field we cover with strip instead of plane, the
less the seam is visible.

Previous (tighter) values that were fine when the two looked
indistinguishable:

```ts
WAVE_STRIP_D        = 100;   // vs 300 today
WAVE_STRIP_SEG_Z    = 40;    // vs 120 today
WAVE_STRIP_OFFSET_Z = 0;     // vs -50 today
```

That's ~3× the needed vertices along Z. Most of those vertices sit far
outside the wave's active Z band (`rel ∈ [-100, 60]` in `waveHeightAt`)
and get flattened by the early-out in `WaveOcean.update`, so they don't
even contribute geometry — just CPU time in the per-vertex loop and
GPU vertex-shader invocations each frame.

Once the water shader (Stage 1 above) makes the flat ocean visually
indistinguishable from the strip, revert `WAVE_STRIP_D` /
`WAVE_STRIP_SEG_Z` / `WAVE_STRIP_OFFSET_Z` to the tighter values. This
is the biggest easy perf win tied to this work and worth doing in the
same pass.

## Open questions

- Seafloor: single dark plane, or textured with a cheap caustics fake?
  Caustics sell shallow water but cost a noise lookup per fragment.
- Do we want water colour to change per level (greener shorebreak vs.
  deep-ocean navy)? If so, colour-by-depth ramp becomes a pair of
  per-level uniforms.
- Mobile budget: one extra render target for depth is basically free;
  a second for refraction is noticeable; planar reflection is
  expensive. We should benchmark on a real device before committing to
  Stage 2 or 3.

## Why the fresnel-only attempt failed

Fresnel works on real water because grazing angles show the *sky
reflection* instead of what's below. Without anything to reflect *or*
anything to see through, `mix(waterColour, skyTint, fresnel)` just
desaturates the wave at the edges. It needs a partner — either a
reflection source or something visible through the surface — for the
eye to read it as water rather than paint. That's why this is a bigger
change than a one-line shader tweak.
