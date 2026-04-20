import { useCallback, useEffect, useState } from 'react';
import Game from './components/Game';
import MenuScreen from './components/MenuScreen';
import { LEVELS, type LevelConfig } from './game/levels';

const ADVANCED_OPTIONS_KEY = 'bws.showAdvancedOptions';
const AUTO_STAND_KEY = 'bws.autoStand';
const SHOW_HOTKEYS_KEY = 'bws.showHotkeys';
const SHOW_MENU_BUTTON_KEY = 'bws.showMenuButton';
const CURRENT_LEVEL_KEY = 'bws.currentLevelId';

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
    () => readBool(SHOW_HOTKEYS_KEY, true),
  );
  const [showMenuButton, setShowMenuButton] = useState<boolean>(
    () => readBool(SHOW_MENU_BUTTON_KEY, true),
  );

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

  /*useEffect(() => {
    if (level) return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('portal') === 'true' && LEVELS[0]) {
      setLevel(LEVELS[0]);
    }
  }, [level]);*/

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
      showHotkeys={showHotkeys}
      showMenuButton={showMenuButton}
    />
  );
}
