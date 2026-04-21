# Follow-up: curling lip + break explosion

## What this is about

When a wave breaks in real life (see `screenshots/dev/image-21.png`, stages
E → G → H) two things happen that our current geometry can't represent:

1. **The lip overhangs and curls forward**, forming a hollow tube underneath
   (the barrel). Between D and G the front face tips past vertical and the
   lip pitches out over the trough.
2. **When the lip crashes into the trough** (H), it throws a large vertical
   column of whitewater upward — often matching or exceeding the original
   crest height. See `screenshots/dev/image-20.png` (breaking right-to-left):
   the big white eruption on the right is taller than the clean face on the
   left.

Right now the whitewater pass (`src/game/whitewater.ts`) is painting foam
onto a flat wave face. That gets us from "blue wave with sparkles" to "wave
with churning broken section" (see `screenshots/dev/image-22.png`), but the
broken section still reads as *flat* — the wall of foam lies along the same
face as the unbroken side. It should bulge outward and upward.

## Why we can't just fix it in the shader

`waveHeightAt(x, z) → y` is a single-valued height field. One Y per XZ.

A curling lip requires **two Y values at the same XZ** — the face curving
down *and* the overhanging lip curving above it. Similarly, a break
explosion that bursts upward and forward off the crest is a 3D volume, not
a displacement of the seafloor.

This is a geometry problem, not a texturing problem. Any number of clever
shader tricks on the current heightmap will still look like a flat wall
with white paint on it.

## Sketch of a solution

Two plausible approaches, roughly ordered by ambition:

### (a) Lip ribbon — additive strip geometry

Keep `waveHeightAt` for the main surface. Add a **separate narrow strip of
geometry** that runs along the break line (the X where the wave is actively
curling). This strip:

- Anchors to the crest at `breakX` (follows `waveZ` along Z).
- Extrudes forward (+Z) and curves down into the trough: a short curl
  about 3-8 units deep, 1-3 units wide.
- Optionally sprouts a vertical **explosion column** that fades up to
  ~1.5× crest height, narrow, concentrated at the current `breakX`.

The strip uses the whitewater shader (same procedural noise), but because
it's real 3D geometry it can cast a silhouette that reads as "the lip
overhanging the face." The explosion column can be a billboard quad or a
cheap puffball of cone geometry tilted back.

Pros:
- Leaves `waveHeightAt` and all its consumers (physics, camera, trail, etc.)
  untouched.
- Localized — only exists where the wave is breaking.
- Cheap: a small strip + a few puff billboards.

Cons:
- Won't support a rideable barrel (the face underneath the lip is still the
  single-valued height field — there's no hollow space to enter).
- Two geometry systems to keep aligned (main surface + lip ribbon).

### (b) Parametric tube — full replacement of the wave surface

Replace the height-field wave strip with a **parametric tube surface**
expressed as `surface(u, v) → (x, y, z)`, where `u` runs along the wave
(along X) and `v` runs across the face and around the curl. For a given
column `u`, the cross-section at the break point is a curve that:

- Rises from flat water (v=0),
- Climbs the face to a peak,
- Curves forward and down (overhanging),
- Terminates inside the barrel or meets the trough.

Pros:
- Actual barrel. You could eventually ride inside it — big gameplay gain.
- More physically honest silhouette.

Cons:
- Large refactor. Physics, camera, wake trail, spray, obstacle placement,
  surfer height sampling — everything currently calls `waveHeightAt(x, z)`.
  You'd need a new `sampleWave(u, v)` + a way to map the surfer's world
  position to `(u, v)`.
- Harder to tune — two-parameter surface vs. two-variable height function.

## Recommendation

Start with **(a) Lip ribbon** as a standalone, additive pass. It's the
fastest way to get silhouette-breaking "wave bulging forward" readability
and the upward explosion. It's also a natural staging point: if gameplay
later demands a rideable barrel, we migrate to (b) with the lip ribbon's
shader, UV layout, and mask logic already dialed in.

## Files that would change

- `src/game/lipRibbon.ts` (new) — mesh, geometry rebuild per frame, shader
- `src/game/wave.ts` — construct the lip ribbon, call its update() from
  `WaveOcean.update`
- `src/game/whitewater.ts` — may share shader code with lip ribbon
- No changes expected to physics / camera / trail / spray unless we also
  want the surfer to collide with or emerge from the lip.

## Open questions

- Does the lip ribbon need vertex animation (peristaltic pulsing along X)
  to sell the feeling of the wave breaking progressively, or is a static
  curl shape anchored to breakX good enough?
- Explosion column: billboard quad (one draw call, always faces camera) vs.
  short-lived particle cloud vs. actual cone geometry? Billboard likely
  wins on simplicity + mobile cost.
- Should the lip ribbon cast shadow onto the face beneath it? That would
  really sell the 3D-ness, but costs a shadow pass.

## Reference images in repo

- `screenshots/dev/image-16.png` — pre-whitewater (original state)
- `screenshots/dev/image-17.png` — reference: clean wave with broken section
- `screenshots/dev/image-18.png` — reference: pointbreak lineup, foam trails
- `screenshots/dev/image-19.png` — reference: multiple waves, clean shape
- `screenshots/dev/image-20.png` — reference: breaking wave with tall foam
  explosion (right-to-left in frame)
- `screenshots/dev/image-21.png` — diagram: wave-break lifecycle A → H
- `screenshots/dev/image-22.png` — current state with whitewater pass done
