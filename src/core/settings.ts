import type { RosettaSettings } from "../types";

const SETTINGS_KEY = "spotify-rosetta:settings:v1";

export const DEFAULT_SETTINGS: RosettaSettings = {
  schemaVersion: 1,
  enabled: true,
  showPartial: true,
  showUnsynced: true,
  wordHighlight: true,
  cacheLimit: 500,
  providers: {
    netease: true,
    qq: true,
    musixmatch: true,
    lyricstranslate: true,
    web: true,
    lrclib: true,
    spotify: true,
    local: true,
  },
};

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function getStorage(): StorageLike | undefined {
  try {
    if (window.Spicetify?.LocalStorage) {
      return {
        getItem: (key) => window.Spicetify?.LocalStorage?.get(key) ?? null,
        setItem: (key, value) => window.Spicetify?.LocalStorage?.set(key, value),
        removeItem: (key) => window.Spicetify?.LocalStorage?.remove(key),
      };
    }
  } catch {
    // Fall through to browser local storage.
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function normalizeSettings(value: unknown): RosettaSettings {
  const input =
    value && typeof value === "object"
      ? (value as Partial<RosettaSettings>)
      : {};
  return {
    schemaVersion: 1,
    enabled: input.enabled ?? DEFAULT_SETTINGS.enabled,
    showPartial: input.showPartial ?? DEFAULT_SETTINGS.showPartial,
    showUnsynced: input.showUnsynced ?? DEFAULT_SETTINGS.showUnsynced,
    wordHighlight: input.wordHighlight ?? DEFAULT_SETTINGS.wordHighlight,
    cacheLimit: Math.max(
      50,
      Math.min(2_000, Number(input.cacheLimit) || DEFAULT_SETTINGS.cacheLimit),
    ),
    providers: {
      ...DEFAULT_SETTINGS.providers,
      ...(input.providers ?? {}),
    },
  };
}

export function loadSettings(): RosettaSettings {
  const storage = getStorage();
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(storage.getItem(SETTINGS_KEY) ?? "{}"));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: RosettaSettings): void {
  const storage = getStorage();
  storage?.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
}

