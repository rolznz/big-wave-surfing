// ─── Wave shape ──────────────────────────────────────────────────────────────
export const WAVE_AMP = 50; // crest height in world units // TODO: customizable wave height
export const WAVE_SIGMA_FRONT = 10; // steepness of front face (smaller = steeper)
export const WAVE_SIGMA_BACK = 20.0; // depth of back slope at the break point
export const WAVE_X_DECAY = 200; // e-fold distance for amplitude on the clean shoulder (right of break)
export const WAVE_X_BROKEN_DECAY = 200; // e-fold distance for amplitude on the broken side (left of break) — shorter so whitewater dies down
export const WAVE_X_SIGMA_SCALE = 60; // every 60 X-units from break, sigmaBack grows by 1
export const WAVE_PEAK_AHEAD_X = 3; // peak sits this far into the clean side of breakX, so the crest curls ahead of the whitewater
export const WAVE_SPEED = 10; // units/sec toward +Z
export const WAVE_START_Z = -100;

// ─── Wave face shading ───────────────────────────────────────────────────────
// Per-vertex colour post-process applied on top of the height/foam ramp.
// FACE_TINT_STRENGTH: how strongly the front face lerps toward COL_TRANSLUCENT
//   at mid-face on the upper half of the wave. 0 = off, 1 = fully replaced.
// BACK_DARKEN_STRENGTH: how much the back slope is darkened at one
//   WAVE_SIGMA_BACK behind the crest. 0 = off, 1 = black at that distance.
export const FACE_TINT_STRENGTH = 0.65;
export const BACK_DARKEN_STRENGTH = 0.65;

// ─── Breaking front (sweeps left → right along X) ────────────────────────────
export const BREAK_START_X = -250;
export const BREAK_SPEED = 5;

// ─── Balance (whitewater drain) ──────────────────────────────────────────────
// Balance is 1 at full, 0 = wipeout. Drains while the surfer is in
// whitewater foam and recovers when clear. At full foam exposure (mask ≥
// FOAM_DRAIN_FULL) full balance lasts BALANCE_DRAIN_TIME seconds.
export const BALANCE_DRAIN_TIME = 4.0;
export const BALANCE_RECOVER_TIME = 2.0;
export const FOAM_DRAIN_FULL = 0.6;
export const FOAM_DRAIN_THRESHOLD = 0.15;

// ─── Balance wobble (low-balance instability) ────────────────────────────────
// As balance drops the surfer rolls side-to-side and gets pushed laterally as
// if losing footing. Both scale with (1 - balance)^2 so the effect ramps in
// non-linearly — full balance feels stable, near-zero feels chaotic.
export const BALANCE_WOBBLE_FREQ_HZ = 1.8; // sway frequency in Hz
export const BALANCE_WOBBLE_ROLL_MAX = 0.55; // radians (~31°) at balance=0
export const BALANCE_PUSH_MAX = 12; // lateral accel (units/sec²) at balance=0
export const BALANCE_DRAG_MAX = 30; // extra drag (units/sec²) at balance=0

// ─── Foam cascade ────────────────────────────────────────────────────────────
// Speed (units/sec along +Z, down the face) at which whitewater rolls forward
// after the break has swept past a given X column. Combined with the natural
// 25-unit forward extent of the trail, ~25/FOAM_CASCADE_SPEED seconds to
// reach full reach on each newly-broken column.
export const FOAM_CASCADE_SPEED = 5.0;

// How much to sink the surfer below the bare wave surface in foamy regions —
// the bare wave height sits well above the visible foam surface in broken
// areas, leaving the rig looking like it floats in midair on top of the
// whitewater. Subtracted from the rig Y, scaled by the foam mask.
export const FOAM_SURFACE_SINK_MAX = 5;
// Time constant (seconds) of the exponential low-pass applied to the sink
// when entering/leaving foam — avoids snapping the rig Y as the surfer
// crosses the foam boundary.
export const FOAM_SINK_TAU = 0.25;

// Miss threshold: if the wave crest passes the surfer by more than this many
// units (waveZ - surferZ), the wave is considered missed and the run ends.
export const MISSED_BY = 20;

// Shore boundary: distance ahead of the wave (in +Z, the wave's motion
// direction) where the sandy beach starts. If the surfer overruns the wave
// and crosses this line they hit dry sand and wipe out.
export const SHORE_Z_OFFSET = 100;

// ─── Ocean mesh ──────────────────────────────────────────────────────────────
// Wave strip mesh — dense, sized to just cover the wave's active footprint.
// X-width must exceed the wave's X footprint (see note); Z-depth must contain
// the wave band (rel ∈ [-100, 60] in waveHeightAt). EDGE_TAPER smoothly drops
// the wave height to 0 at the strip's X borders.
export const WAVE_STRIP_W = 1800;
export const WAVE_STRIP_D = 600;
export const WAVE_STRIP_SEG_X = 200;
export const WAVE_STRIP_SEG_Z = 200;
export const WAVE_STRIP_OFFSET_Z = -200;
export const WAVE_STRIP_EDGE_TAPER = 20;

// ─── Surfer spawn / bounds ───────────────────────────────────────────────────
export const SURFER_START_X = -170;
export const SURFER_START_Z = -30;
export const SURFER_X_LIMIT = 300;

// ─── Stance physics profiles ─────────────────────────────────────────────────
// Prone (lying on board, paddling): slow to turn, can paddle, body creates drag,
// fins barely engaged.
export const PRONE_PHYSICS = {
  PADDLE_THRUST: 20,
  WATER_DRAG: 4.0,
  BRAKE_DRAG: 10.0,
  TURN_SPEED: 1.5,
  WAVE_PUSH_FACTOR: 2.5,
  FIN_GRIP_BASE: 1,
  FIN_GRIP_TURNING: 5,
} as const;

// Standing (feet on board, surfing): quick turns, no paddling, fins engaged,
// wave drives harder.
export const STANDING_PHYSICS = {
  PADDLE_THRUST: 0,
  WATER_DRAG: 1.0,
  BRAKE_DRAG: 20.0,
  TURN_SPEED: 3.5,
  WAVE_PUSH_FACTOR: 5,
  FIN_GRIP_BASE: 4,
  FIN_GRIP_TURNING: 50,
} as const;

// Speed the surfer must be doing to stand up (can't stand on a still board)
export const POPUP_MIN_SPEED = 20;

// ─── Air (off-the-back launch) ───────────────────────────────────────────────
// Auto-triggers when a standing surfer crosses the crest from front to back at
// or above AIR_LAUNCH_MIN_SPEED. Launch upward velocity scales with speed.
export const AIR_LAUNCH_MIN_SPEED = 3; // min speed (units/sec) to launch
// Board must be aimed within this many degrees of "into the wave" (i.e. toward
// the crest / lip, which sits at -Z from the surfer on the front face) to
// launch an air. A perpendicular down-the-line ride is 90° off, so anything
// below 90 here disallows it. 0 = dead-on into the lip; bigger = looser gate.
export const AIR_LAUNCH_MAX_ANGLE_DEG = 80;
// How far in front of the crest (units, +Z from waveZ) the launch line sits.
// 0 = trigger at the crest itself (surfer pops over the back). Bigger = pop
// earlier on the upper face, before they're actually over the lip.
export const AIR_LAUNCH_FRONT_OFFSET = 8;
export const AIR_LAUNCH_VY_FACTOR = 0.6; // airVY = factor × speed at launch
export const AIR_LAUNCH_PEAK_WINDOW = 4; // seconds: jump height uses max speed seen in this trailing window, so decelerating up the face still gives a tall pop
export const AIR_LAUNCH_VY_MAX = 300; // cap on launch upward velocity
export const AIR_GRAVITY = 30; // units/sec² downward while airborne
export const AIR_TURN_SPEED = 7.5; // rad/sec while airborne
// Airborne rig pitch: rotates the deck around its lateral axis with airVY so
// the nose lifts going up and drops on descent — preps for landing on the
// wave's slope. pitch = clamp(airVY / AIR_PITCH_VY_REF, ±1) × AIR_PITCH_MAX_RAD.
// Smaller REF / larger MAX = more dramatic lean.
export const AIR_PITCH_VY_REF = 10; // airVY (units/s) at which pitch hits its cap
export const AIR_PITCH_MAX_RAD = 0.6; // ~34° max pitch in either direction
export const AIR_REDIRECT_RATE = 5; // per-second blend of velocity toward heading
export const AIR_DRAG = 0.05; // mild horizontal damping in flight

// Extra drag applied off the wave, scaled by (1 - waveCouple). Flat water
// brakes the surfer hard so momentum from the wave bleeds off quickly once
// they outrun the wave or get spat off the back.
export const FLAT_WATER_DRAG = 2.0;

// Lead drag — kicks in only once the surfer is more than this many units in
// front of the wave (surferZ - waveZ, +Z = the wave's direction of travel).
// Past the threshold the drag scales linearly with the lead distance, so the
// player can't run arbitrarily far ahead of the wave without it eating their
// speed.
export const LEAD_DRAG_THRESHOLD = 40;
export const LEAD_DRAG_GAIN = 1;

// ─── Board / rig placement ───────────────────────────────────────────────────
export const BOARD_LIFT = 0.2; // standing: offset along wave surface normal (keeps corners above water)
export const PRONE_BOARD_LIFT = -0.5; // prone: paddler's weight sinks the board into the water
export const TRAIL_LIFT = 0.08; // wake trail hovers this much above the wave surface

// ─── Rail engagement ─────────────────────────────────────────────────────────
// Fraction by which the board's cross-slope roll is reduced (rail + fin grip
// lets the deck stay closer to horizontal than the wave face).
export const RAIL_ENGAGEMENT_BASE = 0.5; // always-on while standing
export const RAIL_ENGAGEMENT_GAIN = 0.5; // additional, scaled by lateral velocity

// ─── Wake trail ──────────────────────────────────────────────────────────────
export const TRAIL_DURATION = 5.0; // seconds before a slice fades out
export const TRAIL_SEGMENTS = 150; // max slices kept
export const TRAIL_MAX_SPEED = 15; // speed at which trail reaches full width/brightness
export const TRAIL_HALF_WIDTH = 0.5;
export const TRAIL_SLICE_DIST = 0.6; // emit a slice every N units traveled

// ─── Camera ──────────────────────────────────────────────────────────────────
// Intrinsics shared by all modes.
export const CAMERA_LENS = {
  FOV: 70,
  NEAR: 0.1,
  FAR: 500,
} as const;

// "Fixed" mode: world-axis aligned. Camera sits above/behind the surfer on the
// +Z side and always looks toward -Z, independent of heading. Reads well for
// the diagonal "drop" shot. MIN_CLEARANCE lifts the camera above any wave
// surface between it and the surfer — matters when the wave overtakes the
// surfer and the crest would otherwise sit between camera and subject.
export const CAMERA_FIXED = {
  HEIGHT: 10, // world-Y above surfer
  DISTANCE: 50, // behind surfer on +Z
  LOOK_AHEAD: 15, // look this far toward -Z of surfer
  LOOK_UP: 1, // look target world-Y above surfer
  MIN_CLEARANCE: 4,
} as const;

// "Chase" mode: camera orbits with the surfer's heading so we always see what
// the surfer is heading into. Tighter + lower for an over-the-shoulder feel.
// MIN_CLEARANCE keeps the camera above the wave surface (sampled at the camera
// position and the midpoint toward the surfer) so a crest between camera and
// surfer never occludes the view.
export const CAMERA_CHASE = {
  HEIGHT: 8,
  DISTANCE: 14,
  LOOK_AHEAD: 20,
  LOOK_UP: 1.5,
  MIN_CLEARANCE: 5,
  // World-space +Z offset applied regardless of heading. Keeps the camera
  // ahead of the wave crest (wave travels toward +Z) even when the surfer
  // turns sideways and the heading-relative DISTANCE would pull the camera
  // back into the face of the wave.
  FORWARD_BIAS: 10,
} as const;

// Level-intro zoom: camera starts close to the surfer and eases out to normal
// distance over DURATION seconds. Multiplier scales DISTANCE/HEIGHT in both
// camera modes (and the chase FORWARD_BIAS) — 1.0 is the regular framing.
export const CAMERA_INTRO = {
  START_SCALE: 0.025,
  DURATION: 5.0,
} as const;

// ─── Visual effects ──────────────────────────────────────────────────────────
export const FOAM_CHOP_SCALE = 0.6; // spatial frequency of foam normal noise
export const FOAM_CHOP_SPEED = 2.0; // temporal frequency
export const FOAM_CHOP_STRENGTH = 0.9; // how much the normal is perturbed (0..1)
// Foam fades with wave height: becomes fully opaque once the local wave is at
// this fraction of WAVE_AMP, so foam stays on the crest band and not across flat water.
export const FOAM_HEIGHT_FRAC = 0.35;
// Surface-foam texture scrolls at this fraction of the wave's apparent speed.
// <1 makes the wave visibly overtake the foam — conveys forward roll.
export const FOAM_PARALLAX = 0.1;

// ─── Pumping (arcade input-driven) ───────────────────────────────────────────
// A pump fires when the steering input flips direction (left↔right) and the
// previous direction was held for at least PUMP_MIN_HOLD_S. Each pump adds
// PUMP_IMPULSE to the surfer's velocity along their facing direction.
export const PUMP_IMPULSE = 5; // forward Δv on each rail-flip pump
export const PUMP_MIN_HOLD_S = 0.1; // previous direction must have been held this long
// Max idle time between releasing the previous direction and pressing the
// opposite one. Beyond this the prior direction is "stale" and a pump
// won't fire — distinguishes a deliberate rail-flip from two unrelated turns.
export const PUMP_MAX_NEUTRAL_GAP_S = 0.3;

// ─── Trick notifications ─────────────────────────────────────────────────────
// On-screen dwell time per trick notification (ms). Shorter = snappier.
export const NOTIF_PADDLE_MS = 3500;
export const NOTIF_PUMP_MS = 1000;
export const NOTIF_CARVE_MS = 1500;
export const NOTIF_AIR_MS = 2000;
// Rotational airs (360+) start at this base duration and lengthen by
// NOTIF_AIR_ROT_MS_PER_STEP for each extra 180° beyond 360°.
export const NOTIF_AIR_ROT_MS_BASE = 2000;
export const NOTIF_AIR_ROT_MS_PER_STEP = 500;

// Visual scale (1.0 = base font size). PUMP is tiny; airs scale up with
// rotation count so bigger tricks read as visually bigger.
export const NOTIF_SCALE_PADDLE = 1.1;
export const NOTIF_SCALE_PUMP = 0.45;
export const NOTIF_SCALE_CARVE = 0.85;
export const NOTIF_SCALE_AIR = 1.3;
export const NOTIF_SCALE_AIR_ROT_BASE = 1.6; // 360° air
export const NOTIF_SCALE_AIR_ROT_STEP = 0.25; // per extra 180°
// Hard cap on notification visual scale at render time. Source-side scales
// (carve/air rotations) can compute higher values; the HUD clamps to this
// so big-trick text doesn't dominate the screen.
export const NOTIF_MAX_SCALE = 1.5;

// Carve detection. lean = (lateral velocity right-component) / 8 matches the
// scale used by the existing carve pose. Surfer must be standing, moving
// forward at ≥ CARVE_MIN_FWD_SPEED, leaning past CARVE_LEAN_THRESHOLD.
// Time held above the threshold (same side) accumulates; on release (drops
// below or flips side) we fire CARVE! only if held for at least
// CARVE_MIN_HOLD_S. Points scale linearly with the final hold time.
export const CARVE_LEAN_THRESHOLD = 0.5;
export const CARVE_MIN_FWD_SPEED = 8;
export const CARVE_MIN_HOLD_S = 0.4;

// Stall detection. Standing surfer holding the down arrow (brake) accumulates
// stall time. Fires STALL! on release/stance-change/wipeout if held for at
// least STALL_MIN_HOLD_S.
export const STALL_MIN_HOLD_S = 0.4;

// Backwards detection. Standing surfer whose velocity points roughly opposite
// to their heading (vDotFwd ≤ -BACKWARDS_MIN_SPEED) — e.g. after a half-rotation
// air landing. Fires BACKWARDS! on exit if held for at least BACKWARDS_MIN_HOLD_S.
export const BACKWARDS_MIN_SPEED = 5;
export const BACKWARDS_MIN_HOLD_S = 0.4;

// Notification dwell and base scale for the new tricks (match CARVE's tuning).
export const NOTIF_STALL_MS = 1500;
export const NOTIF_BACKWARDS_MS = 1500;
export const NOTIF_SCALE_STALL = 0.85;
export const NOTIF_SCALE_BACKWARDS = 0.95;

// ─── Scoring ─────────────────────────────────────────────────────────────────
// Per-trick point values. Final score at end of run:
//   round(trickScore × (SCORE_TIME_REF_S / rideTime))
export const TRICK_POINTS_PUMP = 10;
// Carve points scale as TRICK_POINTS_CARVE × (holdTime / CARVE_MIN_HOLD_S)^CARVE_SCORE_EXPONENT.
// Exponent > 1 rewards longer carves super-linearly: e.g. holding twice the
// minimum scores 2^EXP times the base. 2.0 ≈ quadratic, 2.5 = more aggressive.
export const TRICK_POINTS_CARVE = 25;
export const CARVE_SCORE_EXPONENT = 2.0;
// Stall and Backwards use the same shape:
//   base × (holdTime / minHold)^exponent
export const TRICK_POINTS_STALL = 20;
export const STALL_SCORE_EXPONENT = 2.0;
export const TRICK_POINTS_BACKWARDS = 40;
export const BACKWARDS_SCORE_EXPONENT = 2.0;
export const TRICK_POINTS_AIR = 100;
export const TRICK_POINTS_AIR_360 = 300;
export const TRICK_POINTS_AIR_540 = 600;
export const TRICK_POINTS_AIR_720 = 1000;
export const TRICK_POINTS_AIR_STEP_BEYOND_720 = 500;
export const SCORE_TIME_REF_S = 60;
