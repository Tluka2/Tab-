# Tab

A fast, wallpaper-first new tab extension for Chrome and Edge.

## Development

For Edge-specific loading and QA, see [EDGE_QA.md](EDGE_QA.md).

Install dependencies:

```powershell
npm.cmd install
```

Run a web preview:

```powershell
npm.cmd run dev
```

Verify the directly runnable extension without installing dependencies:

```powershell
node scripts\verify-extension.mjs
```

Run a headless Chrome/Edge smoke test and capture desktop plus narrow first viewports:

```powershell
node scripts\smoke-browser.mjs
```

Force the smoke scripts to use Edge:

```powershell
$env:SMOKE_BROWSER='edge'; node scripts\smoke-browser.mjs
$env:SMOKE_BROWSER='edge'; node scripts\smoke-functional.mjs
$env:SMOKE_BROWSER='edge'; node scripts\smoke-extension-load.mjs
$env:SMOKE_BROWSER='edge'; node scripts\smoke-performance.mjs
```

Run a headless functional smoke test for the initial shell, settings panel, visual settings application, local wallpaper upload, settings import, search submit, shortcut add/edit/delete/reorder flows, number-key open, Esc close, and keyboard focus:

```powershell
node scripts\smoke-functional.mjs
```

Verify that Chrome/Edge can load the unpacked MV3 extension directory:

```powershell
node scripts\smoke-extension-load.mjs
```

Package the directly runnable Edge extension:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package-extension.ps1
```

The package is written to `release\tab-edge-extension.zip`.

Run a startup performance smoke test:

```powershell
$env:SMOKE_BROWSER='edge'; node scripts\smoke-performance.mjs
```

Optional thresholds can be adjusted with `SMOKE_DOM_MS`, `SMOKE_LOAD_MS`, and `SMOKE_READY_MS`.

Run the optional Bing wallpaper network smoke test:

```powershell
$env:SMOKE_BROWSER='edge'; node scripts\smoke-bing-network.mjs
```

This test requires external network access. If Edge reports that Internet access is blocked, the local extension can still be validated with `smoke:edge`; Bing daily wallpaper should be retested on a network that allows `https://www.bing.com`.

Headless Chrome may expose the loaded extension target while refusing to render the new tab override page directly. In that case this script reports the extension-load proof as `PASS` and the page-render portion as `SKIP`; use the functional smoke test and manual QA checklist for page behavior.

The same smoke scripts support `SMOKE_BROWSER=chrome` or `SMOKE_BROWSER=edge`. Edge is the primary target for final local verification.

For visible-window Edge validation, use the manual flow in [EDGE_QA.md](EDGE_QA.md). Command-line visible Edge may refuse to expose unpacked extension targets and can report `SKIP` even when the headless extension-load smoke passes.

Build the extension:

```powershell
npm.cmd run build
```

Load the directly runnable extension while npm dependencies are unavailable:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select the `extension` directory.

The packaged zip contains the same files as `extension`. Unzip it before using **Load unpacked** in Edge.

Load the Vite-built extension after running `npm.cmd run build`:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select the `dist` directory.

## Implemented Scope

- Manifest V3 new tab override.
- Svelte + TypeScript + Vite extension shell.
- Bing daily wallpaper fetch and cache.
- Local wallpaper upload and cache.
- Wallpaper attribution display when the source provides it.
- IndexedDB storage for full wallpaper blobs.
- `localStorage` boot preview for thumbnail-first background display.
- Versioned settings object stored in `chrome.storage.local` with web-preview fallback.
- Settings migration and normalization for stored or imported JSON.
- Search box with presets and custom `{query}` templates.
- `/` and `Ctrl+K` search focus, `Esc` overlay close, number-key shortcut open.
- Shortcut add, edit, delete, icon URL, same-origin `/favicon.ico` derivation, optional groups, and grid drag sorting.
- Settings for search position, shortcut visibility, grid density, theme, icon opacity, panel transparency, wallpaper blur, dim, brightness, overlay, keyboard behavior, wallpaper rotation membership, and settings import/export.

## Notes

The Bing wallpaper feature uses `https://www.bing.com/*` as the only host permission. Shortcut favicons are derived from the shortcut site's own `/favicon.ico` by default. Search suggestions and broader network-backed features are intentionally omitted from the first version.

## Manual QA Checklist

Use this checklist after loading the `extension` directory in Chrome or Edge:

1. Open a new tab and confirm the search box paints immediately without a white flash.
2. Press `/` and `Ctrl+K`; both should focus the search box when enabled.
3. Search a normal query and a direct URL.
4. Open settings, fetch Bing daily wallpaper, then open a new tab and confirm the cached preview appears before the full image.
5. Upload a local image wallpaper and confirm it appears after reopening a new tab.
6. Add, edit, delete, and drag-sort shortcuts.
7. Use number keys to open the first shortcuts when focus is not inside an input.
8. Change search engine, custom template, placeholder, search position, shortcut density, theme, panel transparency, icon opacity, blur, dim, brightness, and overlay.
9. Toggle keyboard settings and confirm disabled shortcuts no longer trigger.
10. Mark multiple wallpapers for rotation and confirm new tabs advance through the selected rotation set.
11. Export settings, import the JSON file, and confirm shortcuts and visual preferences are restored.
