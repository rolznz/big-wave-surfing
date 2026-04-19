import { SURFER_X_LIMIT } from './constants';

export interface ObstacleSpec {
  kind: 'rock';
  count: number;
}

export interface LevelConfig {
  id: string;
  name: string;
  description?: string;
  seed: number;
  waveAmpMultiplier?: number;
  waveSpeedMultiplier?: number;
  breakSpeedMultiplier?: number;
  goalX?: number;
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
    waveAmpMultiplier: 0.7,
    waveSpeedMultiplier: 0.9,
    breakSpeedMultiplier: 0.8,
    obstacles: [],
    numStars: 3,
    minStars: 2,
  },
  {
    id: 'reef',
    name: '2 · Reef Break',
    description: 'A punchier wave with a few scattered rocks.',
    seed: 42,
    waveAmpMultiplier: 1.0,
    waveSpeedMultiplier: 1.0,
    breakSpeedMultiplier: 1.0,
    obstacles: [{ kind: 'rock', count: 5 }],
    numStars: 5,
    minStars: 3,
  },
  {
    id: 'heavy',
    name: '3 · Heavy Water',
    description: 'Big wave, fast break, plenty of rocks to dodge.',
    seed: 1337,
    waveAmpMultiplier: 1.4,
    waveSpeedMultiplier: 1.1,
    breakSpeedMultiplier: 1.15,
    obstacles: [{ kind: 'rock', count: 12 }],
    numStars: 7,
    minStars: 4,
  },
  {
    id: 'monster',
    name: '4 · Monster Swell',
    description: 'Towering wall of water. One shot, make it count.',
    seed: 9001,
    waveAmpMultiplier: 1.8,
    waveSpeedMultiplier: 1.2,
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
    waveAmpMultiplier: 1,
    waveSpeedMultiplier: 2.4,
    breakSpeedMultiplier: 2.6,
    obstacles: [],
    numStars: 25,
    minStars: 15,
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
export function levelGoalX(level: LevelConfig): number {
  return level.goalX ?? SURFER_X_LIMIT;
}
export function levelNumStars(level: LevelConfig): number {
  return level.numStars ?? 0;
}
export function levelMinStars(level: LevelConfig): number {
  // Default: all placed stars must be collected.
  return level.minStars ?? levelNumStars(level);
}
