import { defaultSettings, searchEngines, SETTINGS_KEY, SETTINGS_VERSION } from "./defaults";
import type { AppSettings, Shortcut } from "./types";

const hasChromeStorage = () =>
  typeof chrome !== "undefined" && Boolean(chrome.storage?.local);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const asNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

const asEnum = <T extends string>(value: unknown, fallback: T, allowed: readonly T[]): T =>
  typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const normalizeSearchEngineId = (value: unknown): string => {
  const id = asString(value, defaultSettings.search.engineId);
  return searchEngines.some((engine) => engine.id === id) ? id : defaultSettings.search.engineId;
};

const normalizeSearchTemplate = (value: unknown): string => {
  const template = asString(value, defaultSettings.search.customTemplate).trim();
  return template.includes("{query}") ? template : defaultSettings.search.customTemplate;
};

const normalizeShortcuts = (value: unknown): Shortcut[] => {
  if (!Array.isArray(value)) return defaultSettings.shortcuts;
  return value
    .filter(isRecord)
    .map((item, index) => {
      const url = asString(item.url, "").trim();
      const name = asString(item.name, "").trim();
      if (!name || !url) return undefined;
      return {
        id: asString(item.id, crypto.randomUUID()),
        name,
        url,
        icon: asString(item.icon, "") || undefined,
        group: asString(item.group, "") || undefined,
        order: asNumber(item.order, index, 0, 999)
      } satisfies Shortcut;
    })
    .filter((item): item is Shortcut => Boolean(item))
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index }));
};

export const normalizeSettings = (value: unknown): AppSettings => {
  const source = isRecord(value) ? value : {};
  const theme = isRecord(source.theme) ? source.theme : {};
  const wallpaper = isRecord(source.wallpaper) ? source.wallpaper : {};
  const search = isRecord(source.search) ? source.search : {};
  const layout = isRecord(source.layout) ? source.layout : {};
  const keyboard = isRecord(source.keyboard) ? source.keyboard : {};

  return {
    ...defaultSettings,
    version: SETTINGS_VERSION,
    theme: {
      mode: asEnum(theme.mode, defaultSettings.theme.mode, ["auto", "light", "dark"]),
      accentColor: asString(theme.accentColor, defaultSettings.theme.accentColor),
      iconOpacity: asNumber(theme.iconOpacity, defaultSettings.theme.iconOpacity, 0.35, 1),
      panelTransparency: asNumber(theme.panelTransparency, defaultSettings.theme.panelTransparency, 0.45, 0.95)
    },
    wallpaper: {
      source: asEnum(wallpaper.source, defaultSettings.wallpaper.source, ["bing", "local", "rotation"]),
      activeId: typeof wallpaper.activeId === "string" ? wallpaper.activeId : undefined,
      rotationIds: asStringArray(wallpaper.rotationIds),
      fit: asEnum(wallpaper.fit, defaultSettings.wallpaper.fit, ["cover", "contain", "fill", "blur"]),
      blur: asNumber(wallpaper.blur, defaultSettings.wallpaper.blur, 0, 24),
      dim: asNumber(wallpaper.dim, defaultSettings.wallpaper.dim, 0, 0.75),
      brightness: asNumber(wallpaper.brightness, defaultSettings.wallpaper.brightness, 0.55, 1.25),
      overlay: asEnum(wallpaper.overlay, defaultSettings.wallpaper.overlay, ["none", "vignette", "soft"])
    },
    search: {
      engineId: normalizeSearchEngineId(search.engineId),
      customTemplate: normalizeSearchTemplate(search.customTemplate),
      placeholder: asString(search.placeholder, defaultSettings.search.placeholder),
      style: asEnum(search.style, defaultSettings.search.style, ["glass", "solid", "line"]),
      visibility: asEnum(search.visibility, defaultSettings.search.visibility, ["always", "hover", "hidden"])
    },
    shortcuts: normalizeShortcuts(source.shortcuts),
    layout: {
      searchPosition: asEnum(layout.searchPosition, defaultSettings.layout.searchPosition, ["upper", "center", "lower"]),
      showShortcuts: asBoolean(layout.showShortcuts, defaultSettings.layout.showShortcuts),
      shortcutDensity: asEnum(layout.shortcutDensity, defaultSettings.layout.shortcutDensity, [
        "comfortable",
        "compact",
        "dense"
      ]),
      shortcutVisibility: asEnum(layout.shortcutVisibility, defaultSettings.layout.shortcutVisibility, ["always", "hover", "hidden"])
    },
    keyboard: {
      focusSearch: asBoolean(keyboard.focusSearch, defaultSettings.keyboard.focusSearch),
      numberShortcuts: asBoolean(keyboard.numberShortcuts, defaultSettings.keyboard.numberShortcuts)
    }
  };
};

export async function loadSettings(): Promise<AppSettings> {
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    return normalizeSettings(result[SETTINGS_KEY]);
  }

  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return normalizeSettings(undefined);
  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return normalizeSettings(undefined);
  }
}

export async function saveSettings(settings: unknown): Promise<AppSettings> {
  const next = normalizeSettings(settings);
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  }

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}
