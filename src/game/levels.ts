import {
  SURFER_START_X,
  SURFER_X_LIMIT,
  WAVE_AMP,
  WAVE_SIGMA_FRONT,
  WAVE_SIGMA_BACK,
} from "./constants";

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface LevelConfig {
  id: string;
  name: string;
  description?: string;
  seed: number;
  difficulty: Difficulty;
  waveAmpMultiplier?: number;
  waveSpeedMultiplier?: number;
  breakSpeedMultiplier?: number;
  /** Scales the wave's front-to-back thickness (sigma). >1 = wider/gentler, <1 = sharper/thinner. Default 1. */
  waveThicknessMultiplier?: number;
  /** Scales the lateral length of the level. 1 = full run from spawn to SURFER_X_LIMIT. 0.1 = a tenth of that. Default 1. */
  gameDurationMultiplier?: number;
}

export const LEVELS: LevelConfig[] = [
  {
    id: "mellow",
    name: "1 · Mellow Point",
    description: "A clean, easy wave to learn the lines.",
    seed: 1,
    difficulty: 1,
    waveAmpMultiplier: 0.5,
    waveSpeedMultiplier: 2.4,
    breakSpeedMultiplier: 2.6,
    waveThicknessMultiplier: 1.4,
    gameDurationMultiplier: 1,
  },
  {
    id: "reef",
    name: "2 · Reef Break",
    description: "A punchier wave to test your edge control.",
    seed: 42,
    difficulty: 2,
    waveAmpMultiplier: 0.8,
    waveSpeedMultiplier: 2.4,
    breakSpeedMultiplier: 3.6,
    waveThicknessMultiplier: 1.4,
    gameDurationMultiplier: 1,
  },
  {
    id: "heavy",
    name: "3 · Heavy Water",
    description: "Big wave, fast break.",
    seed: 1338,
    difficulty: 3,
    waveAmpMultiplier: 1.2,
    waveSpeedMultiplier: 2.4,
    breakSpeedMultiplier: 4.6,
    waveThicknessMultiplier: 1.8,
    gameDurationMultiplier: 1,
  },
];

export function levelWaveAmp(level: LevelConfig, baseAmp: number): number {
  return baseAmp * (level.waveAmpMultiplier ?? 1);
}
export function levelWaveSpeed(level: LevelConfig, baseSpeed: number): number {
  return baseSpeed * (level.waveSpeedMultiplier ?? 1);
}
export function levelBreakSpeed(level: LevelConfig, baseSpeed: number): number {
  return baseSpeed * (level.breakSpeedMultiplier ?? 1);
}
export function levelWaveThickness(
  level: LevelConfig,
  baseSigma: number,
): number {
  return baseSigma * (level.waveThicknessMultiplier ?? 1);
}
export function levelGoalX(level: LevelConfig): number {
  const m = level.gameDurationMultiplier ?? 1;
  return SURFER_START_X + m * (SURFER_X_LIMIT - SURFER_START_X);
}

export interface LevelWaveParams {
  peakAmp: number;
  sigmaFront: number;
  sigmaBack: number;
}
export function levelWaveParams(level: LevelConfig): LevelWaveParams {
  return {
    peakAmp: levelWaveAmp(level, WAVE_AMP),
    sigmaFront: levelWaveThickness(level, WAVE_SIGMA_FRONT),
    sigmaBack: levelWaveThickness(level, WAVE_SIGMA_BACK),
  };
}
