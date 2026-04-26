import { SURFER_START_X, SURFER_X_LIMIT } from './constants';

export interface ObstacleSpec {
  kind: 'rock';
  count: number;
}

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
  obstacles?: ObstacleSpec[];
  /** Number of stars to scatter on the wave. Default 0. */
  numStars?: number;
  /** Stars required to successfully complete the level. Default = numStars. */
  minStars?: number;
}

export const LEVELS: LevelConfig[] = [
  {
    id: 'mellow',
    name: '1 · Mellow Point',
    description: 'A clean, easy wave to learn the lines.',
    seed: 1,
    difficulty: 1,
    waveAmpMultiplier: 0.7,
    waveSpeedMultiplier: 0.9,
    breakSpeedMultiplier: 0.8,
    waveThicknessMultiplier: 1.1,
    gameDurationMultiplier: 0.3,
    obstacles: [],
    numStars: 3,
    minStars: 2,
  },
  {
    id: 'reef',
    name: '2 · Reef Break',
    description: 'A punchier wave with a few scattered rocks.',
    seed: 42,
    difficulty: 2,
    waveAmpMultiplier: 0.8,
    waveSpeedMultiplier: 1.0,
    breakSpeedMultiplier: 1.0,
    gameDurationMultiplier: 0.3,
    obstacles: [{ kind: 'rock', count: 5 }],
    numStars: 5,
    minStars: 3,
  },
  {
    id: 'heavy',
    name: '3 · Heavy Water',
    description: 'Big wave, fast break, plenty of rocks to dodge.',
    seed: 1338,
    difficulty: 3,
    waveAmpMultiplier: 1,
    waveThicknessMultiplier: 1.1,
    waveSpeedMultiplier: 1.3,
    breakSpeedMultiplier: 1.15,
    gameDurationMultiplier: 0.4,
    obstacles: [{ kind: 'rock', count: 12 }],
    numStars: 7,
    minStars: 4,
  },
  {
    id: 'monster',
    name: '4 · Monster Swell',
    description: 'Towering wall of water. One shot, make it count.',
    seed: 9001,
    difficulty: 4,
    waveAmpMultiplier: 1.5,
    waveThicknessMultiplier: 1.5,
    gameDurationMultiplier: 0.5,
    waveSpeedMultiplier: 1.4,
    breakSpeedMultiplier: 1.3,
    obstacles: [{ kind: 'rock', count: 20 }],
    numStars: 10,
    minStars: 6,
  },
  {
    id: 'star_run',
    name: '5 · Starlit Mountain',
    description: 'No rocks — just a colossal, screaming-fast wave and stars to chase.',
    seed: 2718,
    difficulty: 5,
    waveAmpMultiplier: 1,
    waveSpeedMultiplier: 2.4,
    waveThicknessMultiplier: 1.4,
    breakSpeedMultiplier: 2.6,
    gameDurationMultiplier: 0.4,
    obstacles: [],
    numStars: 15,
    minStars: 10,
  },
  {
    id: 'the_hill',
    name: '6 · The Hill',
    description: 'Something out of a horror movie.',
    seed: 2718,
    difficulty: 5,
    waveAmpMultiplier: 2.5,
    waveSpeedMultiplier: 1.4,
    waveThicknessMultiplier: 1.5,
    breakSpeedMultiplier: 2.0,
    gameDurationMultiplier: 0.7,
    obstacles: [{ kind: 'rock', count: 50 }],
    numStars: 7,
    minStars: 7,
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
export function levelWaveThickness(level: LevelConfig, baseSigma: number): number {
  return baseSigma * (level.waveThicknessMultiplier ?? 1);
}
export function levelGoalX(level: LevelConfig): number {
  const m = level.gameDurationMultiplier ?? 1;
  return SURFER_START_X + m * (SURFER_X_LIMIT - SURFER_START_X);
}
export function levelNumStars(level: LevelConfig): number {
  return level.numStars ?? 0;
}
export function levelMinStars(level: LevelConfig): number {
  // Default: all placed stars must be collected.
  return level.minStars ?? levelNumStars(level);
}
