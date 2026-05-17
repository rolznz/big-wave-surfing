import * as THREE from 'three';
import { Character, CharacterMaterials } from './character';
import { Board } from './board';

export type StanceVariant = 'regular' | 'goofy';

// ── Character ───────────────────────────────────────────────────────────────
// Schema designed to grow: v1 reads only id/name/skin/suit/hair. Future
// optional fields (hairstyle, body, gender, height, ...) get applied at the
// `buildCharacter` boundary so adding them won't reshape stored cosmetics.
export interface CharacterConfig {
  id: string;
  name: string;
  skin: number;
  suit: number;
  hair: number;
  // ─ reserved for future variants (do not read in v1) ─
  // hairstyle?: 'cap' | 'short' | 'long' | 'bald';
  // body?: 'slim' | 'standard' | 'broad';
  // gender?: 'm' | 'f' | 'nb';
  // height?: number;
}

export const CHARACTERS: CharacterConfig[] = [
  { id: 'classic',    name: 'Classic',  skin: 0xe6bfa1, suit: 0x1a1a26, hair: 0x2a1a10 },
  { id: 'sunset',     name: 'Sunset',   skin: 0xd49a78, suit: 0xc24a3b, hair: 0x1a0e09 },
  { id: 'reef',       name: 'Reef',     skin: 0xc9a07a, suit: 0x0d3b4a, hair: 0x2a1a10 },
  { id: 'neon',       name: 'Neon',     skin: 0xeac8a8, suit: 0x1a1a26, hair: 0xcfe34a },
  { id: 'monochrome', name: 'Mono',     skin: 0xe0c5ad, suit: 0x202024, hair: 0xa0a0a8 },
  { id: 'bigwave',    name: 'Big Wave', skin: 0xc99b78, suit: 0x162a3a, hair: 0x1a1006 },
];

// ── Board ───────────────────────────────────────────────────────────────────
export interface BoardConfig {
  id: string;
  name: string;
  color: number;
  // ─ reserved for future variants (do not read in v1) ─
  // length?: number;
  // finCount?: 1 | 2 | 3;
  // finColor?: number;
  // shape?: 'standard' | 'fish' | 'gun';
}

export const BOARDS: BoardConfig[] = [
  { id: 'cream',    name: 'Cream',    color: 0xf2efe6 },
  { id: 'pearl',    name: 'Pearl',    color: 0xe6ecf3 },
  { id: 'lagoon',   name: 'Lagoon',   color: 0x3a8c9c },
  { id: 'sunset',   name: 'Sunset',   color: 0xe46a3a },
  { id: 'kelp',     name: 'Kelp',     color: 0x2f6b3a },
  { id: 'midnight', name: 'Midnight', color: 0x1a2030 },
];

// ── Combined cosmetics blob (the localStorage shape) ────────────────────────
export interface Cosmetics {
  characterId: string;
  boardId: string;
  stance: StanceVariant;
}

export const DEFAULT_COSMETICS: Cosmetics = {
  characterId: 'classic',
  boardId: 'cream',
  stance: 'regular',
};

export function characterById(id: string): CharacterConfig {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

export function boardById(id: string): BoardConfig {
  return BOARDS.find((b) => b.id === id) ?? BOARDS[0];
}

function materialsForCharacter(cfg: CharacterConfig): CharacterMaterials {
  return {
    skin: new THREE.MeshPhongMaterial({ color: cfg.skin }),
    suit: new THREE.MeshPhongMaterial({ color: cfg.suit }),
    hair: new THREE.MeshPhongMaterial({ color: cfg.hair }),
    eye:  new THREE.MeshPhongMaterial({ color: 0x101018 }),
  };
}

// Symmetric factories: today both just read color-ish fields, but they are
// the single seam where future extensible fields get materialized. Callers
// own disposal of the returned Character / Board.
export function buildCharacter(id: string): Character {
  const cfg = characterById(id);
  return new Character(materialsForCharacter(cfg));
}

export function buildBoard(id: string): Board {
  const cfg = boardById(id);
  return new Board(cfg.color);
}
