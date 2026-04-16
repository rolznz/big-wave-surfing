// Wave physics
export const WAVE_AMP         = 50;  // crest height in world units
export const WAVE_SIGMA_FRONT = 10;   // steepness of front face (smaller = steeper)
export const WAVE_SIGMA_BACK  = 20.0;   // depth of back slope at the break point
export const WAVE_X_DECAY     = 200;   // e-fold distance (X units) for amplitude away from break
export const WAVE_X_SIGMA_SCALE = 60;  // every 60 X-units from break, sigmaBack grows by 1
export const WAVE_SPEED       = 10;    // units/sec toward +Z
export const WAVE_START_Z     = -100;   // crest starts here

// Breaking front (left → right along X)
export const BREAK_START_X  = -235;   // left edge of wave
export const BREAK_SPEED    = 5;      // X units/sec
export const WIPEOUT_GRACE  = 5;      // break must pass surfer by this much to wipeout
export const WIPEOUT_HEIGHT = 0.5;    // wave height below which foam can't cause wipeout

// Ocean geometry
export const OCEAN_W           = 500;   // world X: -250 to +250
export const OCEAN_D           = 400;   // local Z extent of mesh
export const OCEAN_SEG_X       = 200;
export const OCEAN_SEG_Z       = 300;
export const OCEAN_MESH_OFFSET_Z = -150; // mesh lags behind surfer by this amount in Z

// Surfer
export const SURFER_START_X  = -150;
export const SURFER_START_Z  = 2;
export const SURFER_X_LIMIT  = 240;   // hard X clamp (ocean half-width − margin)

// Paddle physics
export const PADDLE_THRUST    = 20;
export const WATER_DRAG       = 3.0;
export const BRAKE_DRAG       = 10.0;
export const TURN_SPEED       = 3; // TODO: difference paddling vs standing
export const WAVE_PUSH_FACTOR = 5;
export const FIN_GRIP_BASE    = 4;//4.0;  // lateral bleed rate (units/s²) always active — set to 0 to disable passive grip
export const FIN_GRIP_TURNING = 50;//12.0; // extra lateral bleed rate while left/right held — set to 0 to disable turn-speed waste
