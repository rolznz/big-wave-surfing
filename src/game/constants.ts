// Wave physics
export const WAVE_AMP = 5.5;           // crest height in world units
export const WAVE_SPEED = 10;          // units/sec toward +Z (shore)
export const WAVE_START_Z = -50;       // crest starts here → ~5 s to reach player
export const SHORE_Z = 26;             // wave dies here → ride complete

// Breaking front (travels along +X across the wave face)
export const BREAK_START_X = -25;      // left edge of wave
export const BREAK_SPEED = 3.5;        // X units/sec
export const WIPEOUT_GRACE = 2.5;      // break must pass surfer by this much to wipeout

// Ocean geometry (baked-rotation plane, mesh offset applied in WaveOcean)
export const OCEAN_W = 54;             // world X: -27 to +27
export const OCEAN_D = 92;             // local Z: -46 to +46 → world Z: -56 to +36
export const OCEAN_SEG_X = 80;
export const OCEAN_SEG_Z = 240;
export const OCEAN_MESH_OFFSET_Z = -10; // mesh.position.z to centre coverage

// Surfer
export const SURFER_START_X = 0;
export const SURFER_START_Z = 2;       // waiting position
export const SURFER_RIDE_Z_OFFSET = 1.3; // surfer rides this far ahead (+Z) of crest
export const SURFER_LATERAL_SPEED = 6; // units/sec
export const SURFER_X_MIN = -26;
export const SURFER_X_MAX = 26;
