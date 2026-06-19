# Edge QA Guide

This project includes a directly loadable MV3 extension in `D:\Tab\extension`.

A distributable zip can be generated at `D:\Tab\release\tab-edge-extension.zip`.

## Load in Edge

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose `D:\Tab\extension`.
5. Open a new tab.

## Automated Edge Checks

Run the full no-dependency Edge smoke suite:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\edge-smoke.ps1
```

Optional visible-window automation:

```powershell
node scripts\smoke-edge-visible-newtab.mjs
```

On some Edge builds, command-line visible windows do not expose unpacked extension targets even though headless extension-load verification passes. If this script reports `SKIP`, use the manual `edge://extensions` flow above as the authoritative visible-window check.

Create a release zip:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package-extension.ps1
```

This runs:

- Static MV3 and CSP validation.
- Desktop and narrow viewport screenshots.
- Functional smoke test for search submit, visual settings application, shortcut add/edit/delete/reorder flows, number-key open, Esc close, and keyboard focus.
- Per-wallpaper More dialog visual smoke with desktop and narrow screenshots.
- First-frame cold and warm startup smoke to catch white flash regressions.
- Long rotation memory smoke with 60 rotations, preheated wallpaper consumption checks, three-wallpaper no-repeat checks, object URL accounting, and JS heap sampling.
- Unpacked extension load target verification.
- Startup performance smoke test.

## Manual Checks

After loading in Edge:

1. Open a new tab and confirm the page appears without a white flash.
2. Press `/` and `Ctrl+K`; both should focus search when enabled.
3. Search a normal query and a direct URL.
4. Open settings and verify controls are responsive.
5. Add, edit, delete, and drag-sort shortcuts.
6. Upload a local wallpaper and reopen a new tab.
7. Fetch Bing daily wallpaper and confirm attribution appears when available.
8. Open a wallpaper row's More dialog and confirm fit, position, overlay, blur, dim, brightness, and reset work without changing the wallpaper-list layout.
9. Mark at least three wallpapers for rotation and confirm repeated "Next" actions do not repeat within any three consecutive picks.
10. Confirm repeated "Next" actions feel smooth and do not leave the page in a loading state.
11. Toggle blur, dim, brightness, overlay, theme, layout, and keyboard options.
12. Export settings, re-import the JSON, and confirm preferences are restored.

## Known Headless Limitation

Headless Edge can load the unpacked MV3 extension target, but direct rendering of the new-tab override target may return `chrome-error://chromewebdata/`. The project therefore uses three layers of evidence:

- `smoke-extension-load.mjs` proves Edge loads the unpacked extension.
- `smoke-functional.mjs` proves page behavior in the same Chromium engine.
- Manual Edge loading proves the browser new-tab override path.
