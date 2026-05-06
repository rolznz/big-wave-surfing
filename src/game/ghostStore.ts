import type { GamePhase, Stance } from './loop';

export interface GhostFrame {
  dt: number;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  touchHeadingTarget: number | null;
  stance: Stance;
  phase: GamePhase;
}

export interface GhostRecording {
  levelId: string;
  frames: GhostFrame[];
}

const recordingsByLevel = new Map<string, GhostRecording[]>();

export const ghostStore = {
  add(rec: GhostRecording): void {
    let arr = recordingsByLevel.get(rec.levelId);
    if (!arr) {
      arr = [];
      recordingsByLevel.set(rec.levelId, arr);
    }
    arr.push(rec);
  },
  getForLevel(levelId: string): GhostRecording[] {
    return recordingsByLevel.get(levelId) ?? [];
  },
};
