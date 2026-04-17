// ─── Wave shape ──────────────────────────────────────────────────────────────
export const WAVE_AMP           = 50;    // crest height in world units // TODO: customizable wave height
export const WAVE_SIGMA_FRONT   = 10;    // steepness of front face (smaller = steeper)
export const WAVE_SIGMA_BACK    = 20.0;  // depth of back slope at the break point
export const WAVE_X_DECAY       = 200;   // e-fold distance for amplitude away from break
export const WAVE_X_SIGMA_SCALE = 60;    // every 60 X-units from break, sigmaBack grows by 1
export const WAVE_SPEED         = 10;    // units/sec toward +Z
export const WAVE_START_Z       = -100;

// ─── Breaking front (sweeps left → right along X) ────────────────────────────
export const BREAK_START_X  = -235;
export const BREAK_SPEED    = 5;
export const WIPEOUT_GRACE  = 5;
export const WIPEOUT_HEIGHT = 0.5;

// ─── Ocean mesh ──────────────────────────────────────────────────────────────
export const OCEAN_W             = 500;
export const OCEAN_D             = 400;
export const OCEAN_SEG_X         = 200;
export const OCEAN_SEG_Z         = 300;
export const OCEAN_MESH_OFFSET_Z = -150;

// ─── Surfer spawn / bounds ───────────────────────────────────────────────────
export const SURFER_START_X = -150;
export const SURFER_START_Z = -50;
export const SURFER_X_LIMIT = 240;

// ─── Stance physics profiles ─────────────────────────────────────────────────
// Prone (lying on board, paddling): slow to turn, can paddle, body creates drag,
// fins barely engaged.
export const PRONE_PHYSICS = {
  PADDLE_THRUST:    20,
  WATER_DRAG:       5.0,
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
  WATER_DRAG:       3.0,
  BRAKE_DRAG:       10.0,
  TURN_SPEED:       3.0,
  WAVE_PUSH_FACTOR: 5,
  FIN_GRIP_BASE:    4,
  FIN_GRIP_TURNING: 50,
} as const;

// Speed the surfer must be doing to stand up (can't stand on a still board)
export const POPUP_MIN_SPEED = 4;

// ─── Board / rig placement ───────────────────────────────────────────────────
export const BOARD_LIFT = 0.2;   // offset along wave surface normal (keeps corners above water)
export const TRAIL_LIFT = 0.08;  // wake trail hovers this much above the wave surface

// ─── Wake trail ──────────────────────────────────────────────────────────────
export const TRAIL_DURATION   = 5.0;  // seconds before a slice fades out
export const TRAIL_SEGMENTS   = 150;  // max slices kept
export const TRAIL_MAX_SPEED  = 15;   // speed at which trail reaches full width/brightness
export const TRAIL_HALF_WIDTH = 0.5;
export const TRAIL_SLICE_DIST = 0.6;  // emit a slice every N units traveled

// ─── Camera ──────────────────────────────────────────────────────────────────
export const CAMERA = {
  HEIGHT:       10,   // world-Y above surfer
  DISTANCE_Z:   24,   // behind surfer (+Z)
  LOOK_AHEAD_Z: 15,   // look this far ahead (-Z) of surfer
  LOOK_UP_Y:    1,    // look target world-Y above surfer
  FOV:          70,
  NEAR:         0.1,
  FAR:          500,
} as const;

// ─── Visual effects ──────────────────────────────────────────────────────────
export const FOAM_CHOP_SCALE = 0.6;   // spatial frequency of foam normal noise
export const FOAM_CHOP_SPEED = 2.0;   // temporal frequency
export const FOAM_CHOP_STRENGTH = 0.9; // how much the normal is perturbed (0..1)
// Foam texture scrolls at this fraction of the wave's apparent speed. <1 makes
// the wave visibly overtake the foam — conveys that the wave is rolling forward.
export const FOAM_PARALLAX = 0.1;

export const SPRAY_MAX_PARTICLES = 300;
export const SPRAY_SPAWN_PER_SEC = 80;
export const SPRAY_LIFETIME      = 1.5;
