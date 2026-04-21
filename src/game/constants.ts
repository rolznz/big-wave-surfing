// ─── Wave shape ──────────────────────────────────────────────────────────────
export const WAVE_AMP           = 50;    // crest height in world units // TODO: customizable wave height
export const WAVE_SIGMA_FRONT   = 10;    // steepness of front face (smaller = steeper)
export const WAVE_SIGMA_BACK    = 20.0;  // depth of back slope at the break point
export const WAVE_X_DECAY       = 200;   // e-fold distance for amplitude on the clean shoulder (right of break)
export const WAVE_X_BROKEN_DECAY = 80;   // e-fold distance for amplitude on the broken side (left of break) — shorter so whitewater dies down
export const WAVE_X_SIGMA_SCALE = 60;    // every 60 X-units from break, sigmaBack grows by 1
export const WAVE_PEAK_AHEAD_X  = 3;     // peak sits this far into the clean side of breakX, so the crest curls ahead of the whitewater
export const WAVE_SPEED         = 10;    // units/sec toward +Z
export const WAVE_START_Z       = -100;

// ─── Breaking front (sweeps left → right along X) ────────────────────────────
export const BREAK_START_X  = -235;
export const BREAK_SPEED    = 5;
export const WIPEOUT_GRACE  = 5;
export const WIPEOUT_HEIGHT = 0.5;

// Miss threshold: if the wave crest passes the surfer by more than this many
// units (waveZ - surferZ), the wave is considered missed and the run ends.
export const MISSED_BY      = 10;

// ─── Ocean mesh ──────────────────────────────────────────────────────────────
// Wave strip mesh — dense, sized to just cover the wave's active footprint.
// X-width must exceed the wave's X footprint (see note); Z-depth must contain
// the wave band (rel ∈ [-100, 60] in waveHeightAt). EDGE_TAPER lets the strip
// smoothly meet the flat base plane at its X borders.
export const WAVE_STRIP_W          = 1800;
export const WAVE_STRIP_D          = 300;
export const WAVE_STRIP_SEG_X      = 400;
export const WAVE_STRIP_SEG_Z      = 120;
export const WAVE_STRIP_OFFSET_Z   = -50;
export const WAVE_STRIP_EDGE_TAPER = 20;

// Flat base plane — huge 4-vertex quad that fills the horizon. Sits slightly
// above y=0 so it covers the wave strip's flat-water regions; wave ridges
// rising above FLAT_OCEAN_Y occlude it naturally.
export const FLAT_OCEAN_W = 6000;
export const FLAT_OCEAN_D = 6000;
export const FLAT_OCEAN_Y = 0.05;

// ─── Surfer spawn / bounds ───────────────────────────────────────────────────
export const SURFER_START_X = -200;
export const SURFER_START_Z = -50;
export const SURFER_X_LIMIT = 240;

// ─── Stance physics profiles ─────────────────────────────────────────────────
// Prone (lying on board, paddling): slow to turn, can paddle, body creates drag,
// fins barely engaged.
export const PRONE_PHYSICS = {
  PADDLE_THRUST:    20,
  WATER_DRAG:       4.0,
  BRAKE_DRAG:       10.0,
  TURN_SPEED:       1.5,
  WAVE_PUSH_FACTOR: 2.5,
  FIN_GRIP_BASE:    1,
  FIN_GRIP_TURNING: 5,
} as const;

// Standing (feet on board, surfing): quick turns, no paddling, fins engaged,
// wave drives harder.
export const STANDING_PHYSICS = {
  PADDLE_THRUST:    0,
  WATER_DRAG:       1.0,
  BRAKE_DRAG:       20.0,
  TURN_SPEED:       3.0,
  WAVE_PUSH_FACTOR: 5,
  FIN_GRIP_BASE:    4,
  FIN_GRIP_TURNING: 50,
} as const;

// Speed the surfer must be doing to stand up (can't stand on a still board)
export const POPUP_MIN_SPEED = 15;

// ─── Board / rig placement ───────────────────────────────────────────────────
export const BOARD_LIFT = 0.2;   // offset along wave surface normal (keeps corners above water)
export const TRAIL_LIFT = 0.08;  // wake trail hovers this much above the wave surface

// ─── Rail engagement ─────────────────────────────────────────────────────────
// Fraction by which the board's cross-slope roll is reduced (rail + fin grip
// lets the deck stay closer to horizontal than the wave face).
export const RAIL_ENGAGEMENT_BASE = 0.5;  // always-on while standing
export const RAIL_ENGAGEMENT_GAIN = 0.5;  // additional, scaled by lateral velocity

// ─── Wake trail ──────────────────────────────────────────────────────────────
export const TRAIL_DURATION   = 5.0;  // seconds before a slice fades out
export const TRAIL_SEGMENTS   = 150;  // max slices kept
export const TRAIL_MAX_SPEED  = 15;   // speed at which trail reaches full width/brightness
export const TRAIL_HALF_WIDTH = 0.5;
export const TRAIL_SLICE_DIST = 0.6;  // emit a slice every N units traveled

// ─── Camera ──────────────────────────────────────────────────────────────────
// Intrinsics shared by all modes.
export const CAMERA_LENS = {
  FOV:  70,
  NEAR: 0.1,
  FAR:  500,
} as const;

// "Fixed" mode: world-axis aligned. Camera sits above/behind the surfer on the
// +Z side and always looks toward -Z, independent of heading. Reads well for
// the diagonal "drop" shot. MIN_CLEARANCE lifts the camera above any wave
// surface between it and the surfer — matters when the wave overtakes the
// surfer and the crest would otherwise sit between camera and subject.
export const CAMERA_FIXED = {
  HEIGHT:        10,  // world-Y above surfer
  DISTANCE:      35,  // behind surfer on +Z
  LOOK_AHEAD:    15,  // look this far toward -Z of surfer
  LOOK_UP:       1,   // look target world-Y above surfer
  MIN_CLEARANCE: 4,
} as const;

// "Chase" mode: camera orbits with the surfer's heading so we always see what
// the surfer is heading into. Tighter + lower for an over-the-shoulder feel.
// MIN_CLEARANCE keeps the camera above the wave surface (sampled at the camera
// position and the midpoint toward the surfer) so a crest between camera and
// surfer never occludes the view.
export const CAMERA_CHASE = {
  HEIGHT:        8,
  DISTANCE:      14,
  LOOK_AHEAD:    20,
  LOOK_UP:       1.5,
  MIN_CLEARANCE: 5,
  // World-space +Z offset applied regardless of heading. Keeps the camera
  // ahead of the wave crest (wave travels toward +Z) even when the surfer
  // turns sideways and the heading-relative DISTANCE would pull the camera
  // back into the face of the wave.
  FORWARD_BIAS:  10,
} as const;

// ─── Visual effects ──────────────────────────────────────────────────────────
export const FOAM_CHOP_SCALE = 0.6;   // spatial frequency of foam normal noise
export const FOAM_CHOP_SPEED = 2.0;   // temporal frequency
export const FOAM_CHOP_STRENGTH = 0.9; // how much the normal is perturbed (0..1)
// Foam fades with wave height: becomes fully opaque once the local wave is at
// this fraction of WAVE_AMP, so foam stays on the crest band and not across flat water.
export const FOAM_HEIGHT_FRAC = 0.35;
// Surface-foam texture scrolls at this fraction of the wave's apparent speed.
// <1 makes the wave visibly overtake the foam — conveys forward roll.
export const FOAM_PARALLAX = 0.1;

