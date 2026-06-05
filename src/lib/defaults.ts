import type { AppSettings, SearchEngine } from "./types";

export const SETTINGS_KEY = "tab.settings";
export const BOOT_WALLPAPER_PREVIEW_KEY = "tab.bootWallpaperPreview";
export const SETTINGS_VERSION = 1;

export const searchEngines: SearchEngine[] = [
  { id: "google", name: "Google", template: "https://www.google.com/search?q={query}" },
  { id: "bing", name: "Bing", template: "https://www.bing.com/search?q={query}" },
  { id: "baidu", name: "Baidu", template: "https://www.baidu.com/s?wd={query}" },
  { id: "duckduckgo", name: "DuckDuckGo", template: "https://duckduckgo.com/?q={query}" },
  { id: "github", name: "GitHub", template: "https://github.com/search?q={query}" },
  { id: "youtube", name: "YouTube", template: "https://www.youtube.com/results?search_query={query}" },
  { id: "bilibili", name: "Bilibili", template: "https://search.bilibili.com/all?keyword={query}" },
  { id: "custom", name: "自定义", template: "{query}" }
];

export const defaultSettings: AppSettings = {
  version: SETTINGS_VERSION,
  theme: {
    mode: "auto",
    accentColor: "#70e1c8",
    iconOpacity: 0.9,
    panelTransparency: 0.72
  },
  wallpaper: {
    source: "bing",
    rotationIds: [],
    fit: "cover",
    blur: 0,
    dim: 0.28,
    brightness: 1,
    overlay: "soft"
  },
  search: {
    engineId: "google",
    customTemplate: "https://www.google.com/search?q={query}",
    placeholder: "搜索或输入网址",
    style: "glass",
    visibility: "always"
  },
  shortcuts: [
    {
      id: "github",
      name: "GitHub",
      url: "https://github.com",
      order: 0
    },
    {
      id: "youtube",
      name: "YouTube",
      url: "https://youtube.com",
      order: 1
    }
  ],
  layout: {
    searchPosition: "center",
    showShortcuts: true,
    shortcutDensity: "comfortable",
    shortcutVisibility: "always"
  },
  keyboard: {
    focusSearch: true,
    numberShortcuts: true
  }
};
