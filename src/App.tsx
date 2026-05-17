import { useCallback, useEffect, useState } from 'react';
import Game from './components/Game';
import MenuScreen from './components/MenuScreen';
import { LEVELS, type LevelConfig } from './game/levels';
import {
  BOARDS,
  CHARACTERS,
  Cosmetics,
  DEFAULT_COSMETICS,
  StanceVariant,
} from './game/cosmetics';

const ADVANCED_OPTIONS_KEY = 'bws.showAdvancedOptions';
const AUTO_STAND_KEY = 'bws.autoStand';
const SHOW_HOTKEYS_KEY = 'bws.showHotkeys';
const SHOW_MENU_BUTTON_KEY = 'bws.showMenuButton';
const CURRENT_LEVEL_KEY = 'bws.currentLevelId';
const COSMETICS_KEY = 'bws.cosmetics';

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === 'true') return true;
    if (v === 'false') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // ignore
  }
}

function readCosmetics(): Cosmetics {
  try {
    const raw = localStorage.getItem(COSMETICS_KEY);
    if (!raw) return DEFAULT_COSMETICS;
    const parsed = JSON.parse(raw) as Partial<Cosmetics>;
    const characterId = CHARACTERS.some((c) => c.id === parsed.characterId)
      ? (parsed.characterId as string)
      : DEFAULT_COSMETICS.characterId;
    const boardId = BOARDS.some((b) => b.id === parsed.boardId)
      ? (parsed.boardId as string)
      : DEFAULT_COSMETICS.boardId;
    const stance: StanceVariant =
      parsed.stance === 'goofy' ? 'goofy' : 'regular';
    return { characterId, boardId, stance };
  } catch {
    return DEFAULT_COSMETICS;
  }
}

function writeCosmetics(value: Cosmetics): void {
  try {
    localStorage.setItem(COSMETICS_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export default function App() {
  const [level, setLevel] = useState<LevelConfig | null>(() => {
    try {
      const id = localStorage.getItem(CURRENT_LEVEL_KEY);
      const saved = LEVELS.find((l) => l.id === id);
      if (saved) return saved;
    } catch {
      // ignore
    }
    return LEVELS[0] ?? null;
  });
  const [showAdvancedOptions, setShowAdvancedOptions] = useState<boolean>(
    () => readBool(ADVANCED_OPTIONS_KEY, false),
  );
  const [autoStand, setAutoStand] = useState<boolean>(
    () => readBool(AUTO_STAND_KEY, true),
  );
  const [showHotkeys, setShowHotkeys] = useState<boolean>(
    () => readBool(SHOW_HOTKEYS_KEY, false),
  );
  const [showMenuButton, setShowMenuButton] = useState<boolean>(
    () => readBool(SHOW_MENU_BUTTON_KEY, false),
  );
  const [cosmetics, setCosmetics] = useState<Cosmetics>(() => readCosmetics());

  useEffect(() => {
    writeCosmetics(cosmetics);
  }, [cosmetics]);

  useEffect(() => {
    writeBool(ADVANCED_OPTIONS_KEY, showAdvancedOptions);
  }, [showAdvancedOptions]);

  useEffect(() => {
    writeBool(AUTO_STAND_KEY, autoStand);
  }, [autoStand]);

  useEffect(() => {
    writeBool(SHOW_HOTKEYS_KEY, showHotkeys);
  }, [showHotkeys]);

  useEffect(() => {
    writeBool(SHOW_MENU_BUTTON_KEY, showMenuButton);
  }, [showMenuButton]);

  useEffect(() => {
    try {
      if (level) localStorage.setItem(CURRENT_LEVEL_KEY, level.id);
      else localStorage.removeItem(CURRENT_LEVEL_KEY);
    } catch {
      // ignore
    }
  }, [level]);

  const onExit = useCallback(() => setLevel(null), []);
  const onPickLevel = useCallback((l: LevelConfig) => setLevel(l), []);

  if (!level) {
    return (
      <MenuScreen
        onPlay={onPickLevel}
        showAdvancedOptions={showAdvancedOptions}
        onChangeShowAdvancedOptions={setShowAdvancedOptions}
        autoStand={autoStand}
        onChangeAutoStand={setAutoStand}
        showHotkeys={showHotkeys}
        onChangeShowHotkeys={setShowHotkeys}
        showMenuButton={showMenuButton}
        onChangeShowMenuButton={setShowMenuButton}
        cosmetics={cosmetics}
        onChangeCosmetics={setCosmetics}
      />
    );
  }
  return (
    <Game
      level={level}
      onPickLevel={onPickLevel}
      onExit={onExit}
      showAdvancedOptions={showAdvancedOptions}
      autoStand={autoStand}
      showMenuButton={showMenuButton}
      cosmetics={cosmetics}
    />
  );
}
