# Opus 4.7 Review — Big Wave Surfing

*Reviewer: Claude Opus 4.7. Prior author: Claude Sonnet 4.6. Commit at review time: `f0a09fc`.*

A second-opinion pass on the project as it stands. The goal is **quick wins** and **opinions** — not a wishlist. Where I recommend a direction, I say why, and I flag the traps worth avoiding.

---

## TL;DR

**What's good (keep doing):**
- The wave math is better than it looks. Asymmetric Gaussian + break-front sweep (`src/game/wave.ts:18-37`) is an elegant, cheap substitute for a real fluid sim.
- The board-orientation code (`src/game/loop.ts:239-266`) builds the rotation from surface normal × heading tangent via a cross product. Clean, correct, and the right attachment point for a real rider.
- Zero assets. Zero shaders. Strict TS. Minimal deps. Easy to read, easy to change.

**What's holding it back:**
- The **broken part of the wave** is just a height drop plus a color lerp to near-white. It reads as "plastic sheet with paint on it" because there's no sub-wavelength surface detail, no particles, no volume.
- The **player is one orange box**. No rider, no board separation, no animation hooks, no stance. Every other feature (ragdoll, customization, modes) is blocked on fixing this.
- **No notion of stance.** Paddling prone and standing-up-surfing are physically different activities, and the game currently can't tell them apart. The code already has a `TODO` for this at `src/game/constants.ts:32`.

**Ship-this-week quick wins** (ordered by effort → impact ratio):

| # | Quick win | Rough effort | Impact |
|---|-----------|--------------|--------|
| 1 | Normal perturbation on foam region | 1h | Big visual |
| 2 | Extract inline constants + delete commented values | 20m | Hygiene |
| 3 | Foam overlay layer with canvas-generated bubble texture | 2h | Big visual |
| 4 | Spray particles at break line | 2h | Atmosphere |
| 5 | Fix camera far plane clip (`200` → `500`) + soften fog | 5m | Bug |
| 6 | Split `loop.ts` tick into `updatePhysics(dt)` + `render()` | 30m | Readability |
| 7 | Introduce `Character` class (procedural primitives, no GLB yet) | 3h | Unblocks everything |
| 8 | Stance toggle (prone/standing) + two physics profiles | 2h | Gameplay |

Everything below is the justification for the above, plus the bigger architectural moves (levels, ragdoll, character customization).

---

## 1. Wave realism — especially the broken part

### What's wrong

The wave mesh is a 200×300 `PlaneGeometry` (`src/game/wave.ts:75-76`) with:
- Per-vertex height from `waveHeightAt()` (good).
- Per-vertex color lerped between deep blue → face blue → crest cyan → foam white (`src/game/wave.ts:47-56`).
- Foam regions get height reduced by up to 55% (`src/game/wave.ts:124`).
- `MeshPhongMaterial` with `shininess: 120` (`src/game/wave.ts:84-91`).

That's it. No textures, no normal variation smaller than the vertex grid, no particles, no translucency, no depth cue.

Real whitewater has four things the current render has zero of:
1. **High-frequency surface chop** — the normal is jagged and turbulent, independent of the large-scale height.
2. **Volumetric foam** — it has thickness. Light scatters through the top of it.
3. **Airborne spray** — particles leave the surface at the lip.
4. **Lip translucency** — where the water is thin, backlight comes through it.

You can get ~80% of the way there with no shader work.

### The path I'd take (cheapest → priciest)

#### Quick win #1 — Perturb normals in foam regions (~1 hour, biggest ROI)

After `this.geo.computeVertexNormals()` at `src/game/wave.ts:133`, loop once more over the normal buffer. For every vertex where `foam > 0.05`, add cheap 3D value-noise sampled at `(wx * k, wz * k, time * k)` to the normal, then renormalize. That gives you shimmering, chaotic micro-normals on the foamy part without touching vertex positions or writing a shader. Keep a small `chopScale` and `chopSpeed` constant for tuning.

```ts
// pseudocode — belongs at the end of WaveOcean.update(), after computeVertexNormals()
const nrm = this.geo.attributes.normal;
for (let i = 0; i < nrm.count; i++) {
  if (foamPerVertex[i] > 0.05) {
    const nx = noise3(wx * 0.6, wz * 0.6, time * 2) - 0.5;
    const nz = noise3(wx * 0.6 + 100, wz * 0.6, time * 2) - 0.5;
    // add to existing normal, renormalize
  }
}
nrm.needsUpdate = true;
```

Use a light-weight noise (e.g., hand-rolled 3D value noise or lift the one from `simplex-noise` — ~4KB). You already cache `foam` in the main loop; just store it to a parallel `Float32Array` at the same index.

This single change is the biggest visible realism gain in the whole project.

#### Quick win #3 — Foam overlay plane with a canvas-generated bubble texture (~2 hours)

Don't try to make the wave material itself render foam texture. Instead:
- Second `PlaneGeometry` at the exact same resolution, positioned +0.03 above the wave mesh.
- `MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })`.
- `map` is a canvas texture you generate once at startup: draw 1000 soft white ellipses on a 512×512 canvas, repeat-wrap it, done. Zero asset dependency.
- Per-vertex alpha (custom `alpha` attribute → use `onBeforeCompile` to patch in, or use `MeshBasicMaterial` with `vertexColors` and shove alpha into the color buffer's luminance) driven by the same `foam` value the main mesh uses.
- Scroll the texture offset slowly with `waveZ` so the foam drifts.

This gives you the texture detail of foam without having to hand-author a shader. The overlay can evolve into a proper custom shader later.

#### Quick win #4 — Spray particles at the break line (~2 hours)

`THREE.Points` with a cloud-ish sprite (or just soft white dots). Emit ~5–20 per second at random (x, 0, z) positions sampled along `breakX` near where the wave height is greatest. Each particle has a small upward + backward velocity, gravity, and a 1–2 second lifetime. Re-use slots in a pool rather than allocating.

This is the atmospheric touch that makes screenshots look alive.

#### Medium-term — Lip translucency (custom shader, deferred)

This is the single biggest remaining realism gain but requires replacing `MeshPhongMaterial` with `ShaderMaterial` — and shader tuning eats time. I'd hold off until after the character + stance work is done, because once you have a living character on the wave, the lip detail is the next thing your eye catches. Plan:

- Rim term: `pow(1 - dot(viewDir, normal), 3)` brightens edges of the wave lip.
- Backlight: where `foam > 0.4` and vertex is on the upper third of the wave (height / WAVE_AMP > 0.7), mix in a pale cyan as if sun is coming through.
- Keep everything else Phong-equivalent so the rest of the water looks the same.

#### Long-term — real textures

When the procedural look is tuned and you're sure of the aesthetic, swap in photographed normal/foam maps (ambientCG has free ones). Do this **after** the procedural version looks right, not before — it's easier to tune procedurals and swap textures in, than to fight texture resolution and repeat-tiling at the same time as composition.

### Things not to chase

- **Full PBR water / SSR / real-time caustics.** Wrong aesthetic for this game. The stylized procedural look is a feature; don't Cousteau it.
- **Gerstner / FFT waves.** Your wave isn't ambient sea — it's a single breaking wave with a scripted break front. Gerstner would obscure the gameplay-critical shape.
- **react-three-fiber rewrite.** The current React-for-HUD / Three-for-render split is fine and well-scoped. Rewriting to r3f costs weeks and buys nothing here.

---

## 2. In-water physics — prone vs standing modes

### Current state

All physics is in one block inside `tick()` at `src/game/loop.ts:151-279`. Constants are pulled directly from `src/game/constants.ts`. There's a single `phase: 'surfing' | 'wiped_out'` and no stance concept. `TURN_SPEED` has a literal `TODO: difference paddling vs standing` comment at `src/game/constants.ts:32`.

### What I'd do

#### Step A — Split physics constants into two profiles

Replace loose exports with two structs:

```ts
// src/game/constants.ts
export const PRONE_PHYSICS = {
  PADDLE_THRUST:    20,
  WATER_DRAG:       5.0,   // higher — body is in the water
  BRAKE_DRAG:       10.0,
  TURN_SPEED:       1.5,   // slower — can't really carve on belly
  WAVE_PUSH_FACTOR: 2.5,   // less — board doesn't plane properly until standing
  FIN_GRIP_BASE:    1,     // weak — fins barely engaged when lying down
  FIN_GRIP_TURNING: 5,
};

export const STANDING_PHYSICS = {
  PADDLE_THRUST:    0,     // can't paddle standing up
  WATER_DRAG:       3.0,
  BRAKE_DRAG:       10.0,
  TURN_SPEED:       3.0,
  WAVE_PUSH_FACTOR: 5,
  FIN_GRIP_BASE:    4,
  FIN_GRIP_TURNING: 50,
};
```

#### Step B — Add a stance state

```ts
type Stance = 'prone' | 'standing';
type GamePhase = 'paddling' | 'standing' | 'wiped_out';
```

Or keep one `GamePhase` with all four states — up to you. In `tick()`, look up the physics profile at the top of the physics block:

```ts
const P = stance === 'prone' ? PRONE_PHYSICS : STANDING_PHYSICS;
// ...then use P.PADDLE_THRUST instead of PADDLE_THRUST, etc.
```

#### Step C — Pop-up and lie-down

Bind `Space` to toggle. Guard it:
- **Prone → Standing:** require `speed > 5` (can't stand on a still board) AND `wavePush > 0` (roughly: you're going downhill, you have something to plane on).
- **Standing → Prone:** always allowed.
- On transition, kick off a ~0.3s pose interpolation (see Character section).

#### Step D — Duck-dive (prone only, nice-to-have)

Hold `Down` while prone to briefly lower the character below the foam height threshold, so you can paddle under incoming whitewater. Gameplay upside: adds a survival mechanic that prone mode actually needs.

#### Step E — Jumps / air (standing only, nice-to-have)

Currently `surfer.position.y = waveH + lift` every frame — player is glued to the surface. For airs, switch to integrating Y with gravity when `stance === 'standing'` and `speed * slopeAlongBoard > airThreshold`. Re-attach when `velocity.y < 0` and `y <= waveH + lift`. This is more invasive; defer until the stance system is solid.

### Other in-water physics nice-to-haves

- **Buoyancy restoring force** instead of position-lock — the board drifts slightly under/over the surface and the visual settles in. Almost unnoticeable but feels more alive.
- **Speed-dependent spray under the nose of the board** — ties into the particle system from section 1.
- **Paddle thrust tied to an animation cycle** — thrust only lands on arm pulls, not continuously. This is where procedural arms pay for themselves.

---

## 3. The orange box — character & board architecture

This is the keystone change. Everything else (stance, ragdoll, customization, animations) depends on it.

### Recommendation: procedural primitives, not a GLB model — *for now*

Build the rider out of `CapsuleGeometry` / `BoxGeometry` meshes parented in a skeletal hierarchy. Defer loading a real humanoid model until the gameplay shape is settled.

**Why procedural first:**
1. **Zero asset pipeline.** The project is lean; adding `.glb` files + `GLTFLoader` + async init is friction you don't need yet.
2. **You own the skeleton.** Named joints in code means you can hand-author poses, interpolate between them, and drop in ragdoll bodies without a rigging tool.
3. **Customization is trivial.** Swap material colors on named segments, done.
4. **Matches the project's existing aesthetic.** Stylized procedural geometry already defines the game's look.

**When to switch to GLB:** once poses, ragdoll, and customization all work and feel good, swap the procedural segments for a rigged model. The root transform code doesn't change. This is a 1-day migration, not a 1-week one.

### Character structure — concrete plan

Create `src/game/character.ts`:

```ts
export interface CharacterMaterials {
  skin: THREE.Material;
  suit: THREE.Material;   // wetsuit
  hair: THREE.Material;
}

export class Character {
  readonly root: THREE.Group;          // attach to world at board position
  readonly joints: {                   // every node you'll want to pose
    pelvis: THREE.Group;
    torso: THREE.Group;
    head: THREE.Group;
    shoulderL: THREE.Group; elbowL: THREE.Group; wristL: THREE.Group;
    shoulderR: THREE.Group; elbowR: THREE.Group; wristR: THREE.Group;
    hipL: THREE.Group; kneeL: THREE.Group; ankleL: THREE.Group;
    hipR: THREE.Group; kneeR: THREE.Group; ankleR: THREE.Group;
  };
  readonly materials: CharacterMaterials;

  constructor(mats: CharacterMaterials) { /* build hierarchy, attach meshes */ }

  setPose(pose: PoseName, blend = 1.0): void { /* set local rotations */ }
  blendTo(pose: PoseName, t: number): void { /* 0..1 interp from last pose */ }
  dispose(): void {}
}
```

Notes:
- Each joint is a `THREE.Group`; each limb segment is a `Mesh` child of the joint at the start of the segment.
- Meshes use the shared material dict so re-coloring is one assignment.
- Pose = a dictionary of `jointName → Quaternion`. Hand-author a handful: `'prone_neutral'`, `'prone_paddle_left'`, `'prone_paddle_right'`, `'standing_neutral'`, `'standing_carve_left'`, `'standing_carve_right'`, `'wipeout_limp'`.
- For v1 skip skinning — rigid segments are fine. The lack of smooth deformation is barely noticeable at this camera distance.

### Board object

Create `src/game/board.ts`:

```ts
export class Board {
  readonly root: THREE.Group;
  readonly mesh: THREE.Mesh;
  constructor(color: number) { /* build a rounded-box surfboard mesh */ }
  dispose(): void {}
}
```

A tapered box or a spline-extruded shape — either is fine. Add a small fin at the back for visual readability.

### How they plug in

In `src/game/loop.ts`, the existing surface-normal orientation code (lines 239-266) stays exactly the same, but instead of orienting `surfer`, it orients a new `rig` group:

```ts
const rig = new THREE.Group();
scene.add(rig);
const board = new Board(0xff4500);
const character = new Character({ skin, suit, hair });
rig.add(board.root);
rig.add(character.root);
// (in prone: character.root.position = board top; character lies along board)
// (in standing: character.root.position.y = board top + foot height; feet on board)
```

`rig.position` and `rig.quaternion` are driven exactly as `surfer` is today. The character and board live inside the rig's local frame.

### Per-frame pose updates

```ts
if (stance === 'prone') {
  if (input.up) character.blendTo('prone_paddle_cycle', paddleCycleT);
  else          character.blendTo('prone_neutral', 1.0);
} else {
  const lean = clamp(lateralVelocity / 10, -1, 1);
  if (lean < -0.2) character.blendTo('standing_carve_left', -lean);
  else if (lean > 0.2) character.blendTo('standing_carve_right', lean);
  else                 character.blendTo('standing_neutral', 1.0);
}
```

One state per frame, no animation system, no timelines. Add complexity only if it's missing.

### Customization (later, cheap)

Once the character exists, customization is trivial:
- React UI before game start writes `{ skinColor, suitColor, hairColor, boardColor }` to `localStorage`.
- `Character` constructor reads from there, builds materials with those colors.
- Done in <1 hour.

Shape customization (tall/short, wide/narrow) is the same — pass a `proportions` object into the constructor and scale segment lengths before positioning joints.

---

## 4. Ragdoll on wipeout — my opinion

**Yes, do it. But budget it honestly.**

It's the right call *because* you already plan to build a skeletal character — adding ragdoll to a rigid-segment character is much easier than to a skinned mesh. And a good wipeout is a huge amount of the charm in a surfing/skating game.

### The cheap path

Add **cannon-es** (17KB, straightforward API, well-maintained fork of cannon.js). Only use it for the ragdoll, nothing else. The board's custom kinematic physics stays as-is — it's better suited to the deforming wave surface than any rigid-body engine.

On transition to `wiped_out`:

1. **Snapshot pose.** Capture each joint's world transform.
2. **Build cannon bodies.** One box-or-sphere body per character segment, matched in size and mass.
3. **Wire up constraints.** `ConeTwistConstraint` at each joint (shoulders, hips, neck, elbows, knees) with sensible limits. Cannon-es has these.
4. **Seed velocity.** Each body starts with the character's current linear velocity + a randomized tumble impulse. Add a big "kicked by wave" impulse to the torso.
5. **Step cannon each frame.** Mirror body positions/rotations back to the Three.js meshes until respawn.
6. **Respawn after ~3s.** Fade character to wipeout respawn point, re-enable prone stance.

### The traps

- **Ragdoll tuning is a tar pit.** Joint limits and mass ratios interact non-linearly. Give yourself half a day, accept v1 jank, move on. If you find yourself a week in, cut it and do canned pose blends instead — they look fine for short wipeouts.
- **Don't unify the board and ragdoll under cannon.** The custom wave-driven board physics is elegant precisely because it isn't rigid-body — keep it custom.
- **Don't pre-allocate cannon bodies if they aren't needed** — create on wipeout, dispose on respawn. Wipeout is infrequent and creation is cheap.

### If you *don't* do ragdoll

Fallback: two or three canned wipeout poses (`wipeout_backflop`, `wipeout_pearled`, `wipeout_faceplant`), randomized on trigger, blended into over 0.3s, held through the wipeout, character tumbles with the board in a simple sinusoidal tumble animation. This looks acceptable and costs a few hours. If ragdoll is going poorly, drop to this.

---

## 5. Levels, obstacles, and the camera

### The camera is the right camera

**You're right — the current angle is the best one for this game.** Elevated behind-and-above reads the wave face, the break front, and the lateral space the player has to work with. A lower / behind-board cam loses the wave. A top-down cam loses the face. A lip-level cam loses the player's heading. Don't change it.

### The camera works fine for obstacles

Obstacles that live on or just above the wave surface — rocks, buoys, other surfers, flags, reef markers — are fully visible from this angle. The break front is visible. The wave face is visible. Nothing is occluded.

The camera only breaks for **overhead** obstacles (pier pilings, arches). You don't need those. Don't add them.

### One camera tweak that unblocks level variety

Move the camera offsets to constants, and let `Level` config override them. You probably want slightly different cams for different levels:
- Obstacle course: cam pulled back further and higher to see more of the X axis.
- Tight barrel: cam pulled in for drama.
- Reef break: cam angled slightly to show the reef structure on the right.

```ts
// src/game/constants.ts
export const CAMERA = {
  HEIGHT: 10,          // currently inline at loop.ts:302 ("surferY + 10")
  DISTANCE_Z: 24,      // currently inline at loop.ts:302 ("surferZ + 24")
  LOOK_AHEAD_Z: 15,    // currently inline at loop.ts:303 ("surferZ - 15")
  LOOK_UP_Y: 1,        // currently inline at loop.ts:303 ("surferY + 1")
};
```

### Level system sketch

New file `src/game/levels.ts`:

```ts
export interface LevelConfig {
  name: string;
  wave: Partial<WaveParams>;         // override WAVE_AMP, sigmas, etc.
  break: Partial<BreakParams>;       // BREAK_SPEED, BREAK_START_X
  obstacles: Obstacle[];
  camera?: Partial<CameraParams>;
  winCondition: { kind: 'survive'; seconds: number }
               | { kind: 'distance'; units: number }
               | { kind: 'score'; target: number };
}

export const LEVELS: LevelConfig[] = [
  { name: 'Calm Practice', wave: { WAVE_AMP: 25 }, break: { BREAK_SPEED: 2 }, obstacles: [], winCondition: { kind: 'survive', seconds: 30 } },
  { name: 'Classic Break', wave: {}, break: {}, obstacles: [], winCondition: { kind: 'survive', seconds: 60 } },
  { name: 'Rocky Reef', wave: {}, break: {}, obstacles: [
    { x: -50, z: 10, radius: 4, kind: 'rock' },
    { x:  30, z: -5, radius: 5, kind: 'rock' },
  ], winCondition: { kind: 'survive', seconds: 90 } },
];
```

Refactor `createLoop(bs, onStatus)` → `createLoop(bs, onStatus, level)`. Menu screen picks level; passes down.

### Obstacles — minimum viable

- `interface Obstacle { x: number; z: number; radius: number; mesh: THREE.Object3D; kind: 'rock' | 'flag' | 'surfer' }`.
- Collision = 2D circle-vs-point against `(surferX, surferZ)`. One `for` loop in the physics block. If hit, set `phase = 'wiped_out'`.
- Position obstacles' Y from `waveHeightAt()` each frame so they ride the wave (same as the wake trail does at `src/game/loop.ts:326`).

Don't over-engineer this. A single obstacle array + linear scan is fine up to ~100 obstacles at 60fps.

---

## 6. Code hygiene — small, cheap, do it this week

These are literally-five-minutes items that keep the codebase from calcifying:

1. **Remove commented-out legacy values at `src/game/constants.ts:34-35`:**
   ```ts
   export const FIN_GRIP_BASE    = 4;//4.0;  // ← delete the trailing comment
   export const FIN_GRIP_TURNING = 50;//12.0;
   ```
2. **Extract the inline trail constants** at `src/game/loop.ts:12-18` into `constants.ts`.
3. **Extract the magic `0.2` lift** at `src/game/loop.ts:234` into `BOARD_LIFT`.
4. **Extract the magic `0.08`** at `src/game/loop.ts:326` into `TRAIL_LIFT`.
5. **Extract camera offsets** at `src/game/loop.ts:105-106` and `302-303` into `CAMERA` struct above.
6. **Fix the camera far plane bug.** `src/game/createScene.ts:25` has `200`, but the ocean mesh is 400 deep — only the exponential fog is hiding the clip. Bump far plane to `500` or `600`, and optionally reduce fog density from `0.007` to `0.005` so the horizon isn't so muddy.
7. **Split `tick()` into `updatePhysics(dt)` + `render()`.** The current 230-line `tick` is doing too much. Split makes it possible to test physics in isolation, and also lines up the codebase for possible fixed-timestep physics later. Don't actually switch to fixed timestep now — the 50ms clamp at `loop.ts:149` is fine for single-player — just separate the concerns.
8. **Add Vite HMR for the game loop.** Currently editing `loop.ts` rebuilds but the old loop keeps running until manual refresh. `import.meta.hot.accept()` in Game.tsx that teardown+recreates the loop closes the dev feedback loop.
9. **Delete `SUGGESTIONS.md` at repo root** — or merge its unchecked items into this doc. Having two overlapping roadmap files will lead to drift.

None of these changes fix gameplay. All of them reduce friction for the next month of gameplay changes.

---

## 7. What not to do

Calling these out because they're tempting but wrong for this project:

- **Don't rewrite to react-three-fiber.** The current vanilla-Three + React-for-HUD split is clean and appropriate. r3f's benefits (declarative scene graph, reactive state) don't apply when 95% of the scene is one wave + one rig, both updated imperatively each frame. Cost of rewrite: weeks. Benefit: none.
- **Don't use a physics library for the board.** The wave is a deforming surface; rigid-body engines are terrible at constraining to deforming surfaces. The custom gradient-based kinematic model (`src/game/loop.ts:174-188`) is the right tool. Use cannon-es only for ragdoll.
- **Don't try to tune the Phong wave into looking photorealistic.** It won't. Either stylize it further (which it's already doing well) or commit to a custom shader. No middle ground.
- **Don't add a scoring / trick / combo system before the stance toggle works.** Scoring without standing/carving/airing is hollow. Ship stance first, then it becomes obvious what's worth scoring.
- **Don't add mobile touch controls yet.** Gameplay is still being defined. Mobile adds layout constraints, a second input paradigm, and testing overhead. Revisit once the gameplay loop is locked.

---

## 8. Suggested order of attack

If I were you, I'd ship in this order:

**Week 1 — hygiene + visual uplift (no new features):**
- Quick wins 2, 5, 6 from the top table (constants, camera clip, tick split).
- Quick win 1 (normal perturbation on foam).
- Quick win 3 (foam overlay).
- Quick win 4 (spray particles).

At this point the wave looks ~3× better and the code is set up for real feature work.

**Week 2 — character + stance:**
- Quick win 7 (`Character` class with procedural primitives).
- Quick win 8 (prone/standing toggle + two physics profiles).
- Wire poses into stance and velocity.

At this point the game has a real player and two genuinely different modes of play.

**Week 3 — levels + obstacles:**
- Camera offsets to constants.
- `Level` struct + 3 levels.
- Obstacle collision + rock meshes.

At this point there's actual progression.

**Week 4 — polish: ragdoll OR canned wipeouts:**
- Try cannon-es ragdoll for half a day. If it feels right, keep tuning. If it's a mess, switch to canned poses and ship.

**Later:**
- Customization UI.
- Trick system / scoring.
- Audio.
- Lip-translucency shader (the last ~20% of wave realism).
- Real textures / GLB migration.

---

## Appendix — specific file references

For grep-ability. Each is a claim-and-line in the current codebase (commit `f0a09fc`).

- Wave height function: `src/game/wave.ts:18-37`.
- Foam computation: `src/game/wave.ts:120-124`.
- Foam color lerp: `src/game/wave.ts:47-56`.
- Wave material (Phong, no shader): `src/game/wave.ts:84-91`.
- Wave mesh resolution (200 × 300): `src/game/wave.ts:75-76`.
- Vertex-normal recompute: `src/game/wave.ts:133` — the insertion point for quick win #1.
- Single orange box player: `src/game/loop.ts:50-57`.
- Board surface-normal orientation: `src/game/loop.ts:239-266` — reuse this for the rig.
- Physics block: `src/game/loop.ts:151-279`.
- Inline magic `0.2` lift: `src/game/loop.ts:234`.
- Inline magic `0.08` trail lift: `src/game/loop.ts:326`.
- Inline trail constants: `src/game/loop.ts:12-18`.
- Inline camera offsets: `src/game/loop.ts:105-106, 302-303`.
- Physics constants: `src/game/constants.ts:28-35`.
- Stance TODO: `src/game/constants.ts:32`.
- Commented legacy values: `src/game/constants.ts:34-35`.
- Camera far plane bug: `src/game/createScene.ts:25` (`200`, should be `~500`).
- Lighting (fine, leave alone): `src/game/createScene.ts:29-39`.
- Game loop wiring: `src/components/Game.tsx`.

---

*End of review. Happy surfing.*
