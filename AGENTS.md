# Project Agent Guide

## Project Goal

Build a browser extension for a customizable new tab page, inspired by PlainTab. The product should preserve PlainTab's fast, minimal wallpaper-first experience while adding stronger customization for shortcuts, search, layout, and visual appearance.

The first target browsers are Chrome and Edge using Manifest V3.

## Product Direction

The extension replaces the browser new tab page with a local, high-performance interface. The experience should feel fast, calm, and customizable rather than heavy or dashboard-like.

Core product principles:

- Fast first paint is more important than feature density.
- User data and configuration should stay local by default.
- Customization should be direct and visual.
- The interface should work well without network access after initial setup.
- Features should be added in layers, without compromising new-tab startup speed.

## Required Feature Scope

### PlainTab-Inspired Base

The project should include the practical equivalent of PlainTab's core capabilities:

- Manifest V3 new tab override.
- Static new tab page loaded from the extension.
- Bing daily wallpaper support.
- Local wallpaper upload support.
- Wallpaper caching.
- Fast background display on new tab open.
- Low-latency search box.
- Basic settings panel.
- Local configuration persistence.
- Optional standalone web mode if it does not complicate the extension architecture.

### Wallpaper System

The wallpaper system is a major feature and should be designed carefully.

Required:

- Support local image wallpapers.
- Support Bing daily wallpapers.
- Support multiple wallpapers and rotation.
- Support cached wallpaper loading.
- Support blur, dim, brightness, and overlay controls.
- Use a thumbnail-first loading strategy to avoid blank or flashing backgrounds.
- Store large image blobs in IndexedDB.
- Store small boot-time preview data in localStorage when useful.

Future-friendly:

- Local video backgrounds.
- Online image URL backgrounds.
- Dynamic WebGL or canvas backgrounds.
- Theme/background import packages.

Wallpaper Engine integration is not part of the first version. Browser extensions cannot reliably control or read Wallpaper Engine directly without a separate native application. If this is explored later, treat it as an optional advanced integration using a native messaging bridge, not as a core dependency.

### Search System

Required:

- Search box on the new tab page.
- Keyboard focus shortcut such as `/` or `Ctrl+K`.
- User-configurable search engine.
- Custom search URL templates using a placeholder such as `{query}`.
- Common presets, including Google, Bing, Baidu, DuckDuckGo, GitHub, YouTube, and Bilibili.
- Configurable placeholder text and search box style.

Search suggestions are optional and should not be part of the first implementation unless privacy and API behavior are clearly defined.

### Shortcuts

Required:

- Add, edit, delete, and reorder website shortcuts.
- Each shortcut should support name, URL, icon, and optional group.
- Automatically fetch or derive favicon where possible.
- Allow custom icon upload later if the initial implementation does not include it.
- Support quick opening by keyboard number shortcuts.

The first version should use grid-based drag sorting. Free-position desktop-style dragging can be added later after responsive behavior is designed.

### Layout And Customization

Required:

- Configurable search box position.
- Configurable shortcut section visibility.
- Configurable shortcut grid density.
- Basic theme controls such as light/dark/auto, accent color, icon opacity, and panel transparency.
- Settings panel for all user-facing configuration.

Future-friendly:

- Drag-resizable components.
- Freeform widget placement.
- Component visibility controls.
- Import/export of full configuration.
- Theme packages.

### Keyboard Behavior

Required:

- `/` or `Ctrl+K` focuses the search box.
- `Esc` closes overlays/settings.
- Number keys can open pinned shortcuts when focus is not inside an input.

Global browser shortcuts may be added using the extension `commands` API, but this should be treated as limited browser functionality rather than a general system-wide hotkey system.

## Technical Direction

Preferred stack:

- Manifest V3 browser extension.
- Vite.
- Svelte.
- TypeScript.
- IndexedDB for large wallpaper assets.
- `chrome.storage.local` for extension configuration.
- `localStorage` only for tiny boot-critical data such as wallpaper thumbnails.

This stack is chosen to support a richer customization UI than PlainTab while keeping the new tab page lightweight. If a feature can be implemented without adding a heavy dependency, prefer the lighter implementation.

## Performance Rules

New tab pages are latency-sensitive. Follow these constraints:

- Do not block first paint on network requests.
- Do not block first paint on loading the settings UI.
- Do not load large images before showing a cached preview.
- Keep the boot path small and predictable.
- Lazy-load nonessential panels and advanced controls.
- Avoid remote fonts in the default UI.
- Avoid large UI libraries unless there is a clear reason.
- Keep background transitions smooth and avoid visible white flashes.

Recommended boot sequence:

1. Load minimal HTML and CSS.
2. Read boot wallpaper preview from localStorage.
3. Render background and search shell immediately.
4. Load saved configuration.
5. Load full-resolution wallpaper from IndexedDB or network.
6. Mount optional panels and advanced UI after first paint.

## Data Model Guidelines

Use a versioned settings object so future migrations are possible.

Suggested top-level shape:

```ts
type AppSettings = {
  version: number;
  theme: ThemeSettings;
  wallpaper: WallpaperSettings;
  search: SearchSettings;
  shortcuts: Shortcut[];
  layout: LayoutSettings;
  keyboard: KeyboardSettings;
};
```

Do not scatter persistent settings across unrelated storage keys unless there is a performance reason. If boot-time data needs to be separate, document why.

## Browser And Store Constraints

The extension must respect browser extension limits:

- Use Manifest V3.
- Do not rely on remotely hosted executable code.
- Do not inject scripts into arbitrary pages unless a feature explicitly requires it.
- Avoid broad permissions.
- Prefer local-only data storage.
- Keep privacy implications clear for any network-backed feature.

The project should not attempt to modify native browser UI such as the address bar, tab strip, or browser chrome. The supported customization surface is the new tab page, extension pages, optional side panel, and extension settings.

## Roadmap

### v0.1: PlainTab-Style Foundation

- New tab override.
- Basic search.
- Bing daily wallpaper.
- Local wallpaper upload.
- Wallpaper cache.
- Thumbnail-first loading.
- Basic settings.

### v0.2: Shortcuts

- Add/edit/delete shortcuts.
- Favicon support.
- Grid display.
- Drag sorting.
- Number-key quick open.

### v0.3: Customization

- Search box position and style.
- Shortcut grid density.
- Theme controls.
- Wallpaper blur/dim/brightness controls.
- Import/export settings.

### v0.4: Enhanced Backgrounds

- Local video wallpaper.
- Wallpaper rotation rules.
- More background effects.
- Dynamic background presets.

### v0.5: Advanced Layout

- Optional freeform layout mode.
- Component visibility controls.
- Drag-resizable widgets.
- Theme packages.

## Implementation Standards

- Keep code modular and easy to reason about.
- Prefer explicit state and typed data structures.
- Keep storage access behind small helper modules.
- Keep browser API usage isolated where practical.
- Avoid premature abstraction, but do not duplicate storage or migration logic.
- Keep UI controls accessible by keyboard.
- Test core flows manually in Chrome or Edge before considering a feature complete.

## Non-Goals For Early Versions

- Direct Wallpaper Engine control.
- Native app bridge.
- Cloud account sync.
- Search suggestions from third-party APIs.
- Full browser UI replacement.
- A widget marketplace.
- Complex remote theme execution.

These can be revisited later, but they should not block the first usable extension.
