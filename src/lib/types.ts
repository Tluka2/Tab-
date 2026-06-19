export type ThemeMode = "auto" | "light" | "dark";
export type WallpaperFit = "cover" | "contain" | "fill" | "blur" | "ambient";
export type WallpaperPosition = "center" | "top" | "bottom" | "left" | "right";
export type WallpaperSource = "bing" | "local" | "rotation";
export type SearchPosition = "upper" | "center" | "lower";
export type SearchStyle = "glass" | "solid" | "line";
export type SearchVisibility = "always" | "hover" | "hidden";
export type ShortcutVisibility = "always" | "hover" | "hidden";
export type GridDensity = "comfortable" | "compact" | "dense";

export type ThemeSettings = {
  mode: ThemeMode;
  accentColor: string;
  iconOpacity: number;
  panelTransparency: number;
};

export type WallpaperItem = {
  id: string;
  name: string;
  source: "bing" | "local";
  blobId: string;
  thumbDataUrl?: string;
  previewDataUrl?: string;
  createdAt: number;
  lastUsedAt?: number;
  attribution?: string;
  contentHash?: string;
  fit?: WallpaperFit;
  position?: WallpaperPosition;
  blur?: number;
  dim?: number;
  brightness?: number;
  overlay?: "none" | "vignette" | "soft";
};

export type WallpaperSettings = {
  source: WallpaperSource;
  activeId?: string;
  rotationIds: string[];
  rotationRecentIds: string[];
  rotationNextId?: string;
  fit: WallpaperFit;
  position: WallpaperPosition;
  blur: number;
  dim: number;
  brightness: number;
  overlay: "none" | "vignette" | "soft";
};

export type SearchEngine = {
  id: string;
  name: string;
  template: string;
};

export type SearchSettings = {
  engineId: string;
  customTemplate: string;
  placeholder: string;
  style: SearchStyle;
  visibility: SearchVisibility;
};

export type Shortcut = {
  id: string;
  name: string;
  url: string;
  icon?: string;
  group?: string;
  order: number;
};

export type LayoutSettings = {
  searchPosition: SearchPosition;
  showShortcuts: boolean;
  shortcutDensity: GridDensity;
  shortcutVisibility: ShortcutVisibility;
};

export type KeyboardSettings = {
  focusSearch: boolean;
  numberShortcuts: boolean;
};

export type AppSettings = {
  version: number;
  theme: ThemeSettings;
  wallpaper: WallpaperSettings;
  search: SearchSettings;
  shortcuts: Shortcut[];
  layout: LayoutSettings;
  keyboard: KeyboardSettings;
};
