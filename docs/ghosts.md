# Add ghosts of past attempts

## Context

We want a "ghosts" feature: every time the player finishes a run (any outcome — wipeout, miss, or completion), the run is captured. On subsequent runs of the same level, every captured run plays back as a translucent ghost surfer with a faded wake trail, alongside the live player.

This makes a session feel populated — you can see the lines you took before, what worked, what didn't. It also acts as a soft personal-best visualization.

User-confirmed shape:
- **Scope**: all completed runs this session, any outcome (not just fails).
- **Persistence**: in-memory only — cleared on page reload.
- **Visual**: translucent surfer + faded wake trail.
- **Recording model**: per-frame `(dt, inputs, stance, phase)`. Ghosts **re-simulate** their own physics from the recording. This is more expensive than position playback but means future physics changes (e.g. ragdoll) automatically apply to old ghosts.

## Recording

Captured every tick while `phase === 'surfing'`:
```ts
interface GhostFrame {
  dt: number;
  left: boolean; right: boolean; up: boolean; down: boolean;
  touchHeadingTarget: number | null;
  stance: 'prone' | 'standing';
  phase: GamePhase;   // last frame will hold the ending phase
}

interface GhostRecording {
  levelId: string;
  frames: GhostFrame[];
}
```

`stance` and `phase` are recorded per-frame (not as discrete events) so ghost playback can apply them as overrides without needing to replay Space presses or re-detect collisions.

## Ghost re-simulation model

Each ghost owns a **complete copy of surfer physics state**:
- `surferX, surferZ, surferVX, surferVZ, surferAngle, stance`
- `paddleCycleT, paddleRestBlend`
- Own `waveZ` scalar, advanced by `dt * waveSpeed * waveSpeedMul` each ghost step (mirrors `wave.update`'s scroll, computed locally — does **not** create a separate `WaveOcean`).
- Own `breakX`, `rideTime`.

Each ghost step does:
1. Write recorded inputs into ghost's `input` object.
2. Override `stance` from the recording (handles Space toggles + auto-stand uniformly).
3. Run a copy of `updatePhysics` (extracted to a pure function — see refactor below) using the ghost's state and recorded `dt`.
4. **Skip** obstacle collision and wipeout-overtake checks — instead, set ghost's `phase` directly from the recording. This means ghosts don't need their own copies of obstacle/star systems.
5. Update the ghost's `Character` pose with the existing `updateCharacterPose` logic.
6. Update the ghost's rig transform (`updateRigTransform`) using the live shared wave height function with ghost's own `waveZ`.
7. Append a trail slice to the ghost's own faded trail mesh.

**Ghost time vs. live time**: each live tick, accumulate `liveDt` into each ghost's `pendingDt`. While `pendingDt >= recordedFrame.dt`, consume one recorded frame and step the ghost. This keeps ghost wall-clock pace matched to its original recording's pace, regardless of current frame rate. When the recording is exhausted, the ghost freezes (stays at its final transform — appropriate for both wipeout and completion).

## Refactor: extract pure physics step

Currently `updatePhysics(dt)` in `loop.ts` reads/writes module-closure state (`surferX`, etc.) and mutates `phase`, `character`, `obstacleSys`, `starSys`. Refactor it so the *core movement integration* operates on a **state object passed in**:

```ts
interface SurferState {
  x: number; z: number; vx: number; vz: number; angle: number;
  stance: Stance;
  paddleCycleT: number; paddleRestBlend: number;
  waveZ: number; breakX: number; rideTime: number;
}

interface PhysicsParams {
  peakAmp; waveSpeed; waveSpeedMul; breakSpeed;
  sigmaFront; sigmaBack;
}

// Pure: integrates one step of movement + paddle bookkeeping.
// Does NOT handle: obstacle collision, star pickup, wipeout-overtake check,
// completion check, miss check, stats, character poses.
function stepSurfer(
  state: SurferState,
  input: InputState,
  dt: number,
  params: PhysicsParams,
): { gradX: number; gradZ: number };
```

The live loop then wraps `stepSurfer` with the side-effects it needs (collision, stats, phase transitions, character poses). Ghosts call `stepSurfer` and `updateCharacterPose` only.

This refactor is the largest structural change but makes the ghost code small and keeps physics logic single-sourced.

## File changes

### NEW `src/game/ghostStore.ts`
Module-scoped singleton: `Map<levelId, GhostRecording[]>` with `add(rec)` and `getForLevel(id)`. In-memory; not persisted.

### NEW `src/game/ghosts.ts`
Exports `createGhostManager(scene, level, params, sharedWave)`:
- On init, reads recordings for `level.id` from `ghostStore`, builds one `GhostInstance` per recording.
- Each `GhostInstance` owns: full `SurferState`, a `THREE.Group` rig, a translucent `Character`, a faded trail mesh (same geometry/material setup as live trail but lower alpha + non-additive).
- `step(liveDt)` advances each ghost as described above.
- `dispose()` removes all rigs/trails from scene and disposes geometries/materials.

Translucent ghost materials: build `CharacterMaterials` with `transparent: true, opacity: 0.35, depthWrite: false`. Render order set so ghosts draw after live surfer.

### MODIFY `src/game/character.ts`
Add an optional argument to `defaultMaterials()` for ghost variant — or just build the materials inline in `ghosts.ts`. Prefer inline (no API change to Character).

### MODIFY `src/game/loop.ts`
- Extract `stepSurfer` (pure) per refactor above.
- Add `recording: GhostFrame[] = []`.
- Inside `tick()` while `phase === 'surfing'`, push current frame.
- When phase transitions away from `'surfing'` (in updatePhysics — three exit points: completed, missed_wave, wiped_out × 2), push one final frame carrying the new phase, then `ghostStore.add({ levelId: level.id, frames: recording.slice() })`.
- Create `ghostManager` after world objects; call `ghostManager.step(dt)` each tick (regardless of live phase — ghosts continue replaying even after live player wipes).
- Add `ghostManager.dispose()` to the existing `stop()` cleanup.

### `src/components/Game.tsx`
No changes required — `runKey` increments cause `createLoop` to be re-invoked, which picks up newly-stored ghosts.

## Critical files

- `src/game/loop.ts` — recording, ghost manager wiring, physics extraction (lines ~150–600).
- `src/game/character.ts` — translucent material construction.
- `src/game/wave.ts` — `waveHeightAt` used by ghosts (no changes, just imported).

## Notes / tradeoffs

- **Performance**: each ghost runs ~the same physics work as the live surfer plus character pose blending and a trail rebuild. ~10 ghosts should be comfortable; if perf becomes an issue we can add a cap or skip pose blending. Not adding a cap up front per the user's "all fails this session" answer.
- **Determinism**: re-simulation uses recorded `dt` per frame, so `Math.min(dt, 0.05)` clamping is irrelevant during replay (already-clamped values were recorded). No `Math.random` is used in physics, so reruns match exactly.
- **Wave/obstacle decoupling**: ghost has its own `waveZ`/`breakX`. Obstacle collisions are not re-detected — recorded `phase` is authoritative. This means ghost stays visually consistent with what the player actually did, even if obstacle positions or collision logic change between recording and replay.
- **Ragdoll-readiness**: when ragdoll lands, replacing `character.setPose('wipeout_limp')` with ragdoll physics in `updateCharacterPose` will affect ghosts automatically (ghost calls the same pose function). Ragdoll itself must be deterministic from `(state, dt)` for old ghosts to look identical to new ones — flag this when ragdoll is designed.

## Verification

1. `yarn build` — typecheck passes.
2. Open the game, pick a level. No ghosts on first attempt.
3. Wipe out (run into an obstacle, or stall and let the wave pass). Hit retry.
4. On the new attempt, expect to see one translucent ghost surfer following the prior path with a faded trail.
5. Fail again. Retry. Now expect two ghosts.
6. Complete the level. Retry. Confirm completed runs also produce ghosts.
7. Switch to a different level via the menu. Confirm ghosts are level-specific (no carryover).
8. Reload the page. Confirm all ghosts are gone.
9. Visual check: ghost surfer is clearly translucent and behind the live surfer in render order; trails don't overpower the live wake.
