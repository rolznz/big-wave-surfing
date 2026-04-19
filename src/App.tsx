import { useCallback, useEffect, useState } from 'react';
import Game from './components/Game';
import MenuScreen from './components/MenuScreen';
import type { LevelConfig } from './game/levels';

const ADVANCED_OPTIONS_KEY = 'bws.showAdvancedOptions';
const AUTO_STAND_KEY = 'bws.autoStand';

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
  const [level, setLevel] = useState<LevelConfig | null>(null);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState<boolean>(
    () => readBool(ADVANCED_OPTIONS_KEY, false),
  );
  const [autoStand, setAutoStand] = useState<boolean>(
    () => readBool(AUTO_STAND_KEY, true),
  );

  useEffect(() => {
    writeBool(ADVANCED_OPTIONS_KEY, showAdvancedOptions);
  }, [showAdvancedOptions]);

  useEffect(() => {
    writeBool(AUTO_STAND_KEY, autoStand);
  }, [autoStand]);

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
    />
  );
}
