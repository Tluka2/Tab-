(() => {
  try {
    const preview = localStorage.getItem("tab.bootWallpaperPreview");
    if (preview) {
      document.documentElement.style.setProperty("--boot-wallpaper", `url("${preview}")`);
      document.documentElement.classList.add("has-boot-wallpaper");
    }
    const settings = JSON.parse(localStorage.getItem("tab.bootSettings") || "null");
    if (!settings || typeof settings !== "object") return;
    const root = document.documentElement;
    const themeMode = settings.theme?.mode;
    const resolvedTheme =
      themeMode === "light" || themeMode === "dark"
        ? themeMode
        : window.matchMedia?.("(prefers-color-scheme: light)")?.matches
          ? "light"
          : "dark";
    root.classList.add(`boot-theme-${resolvedTheme}`);
    const wallpaper = settings.wallpaper || {};
    if (typeof wallpaper.fit === "string") root.classList.add(`boot-fit-${wallpaper.fit}`);
    if (typeof wallpaper.position === "string") root.style.setProperty("--boot-wallpaper-position", wallpaper.position);
    if (typeof wallpaper.blur === "number") root.style.setProperty("--boot-wallpaper-blur", `${wallpaper.blur}px`);
    if (typeof wallpaper.dim === "number") root.style.setProperty("--boot-wallpaper-dim", String(wallpaper.dim));
    if (typeof wallpaper.brightness === "number") root.style.setProperty("--boot-wallpaper-brightness", String(wallpaper.brightness));
    if (typeof wallpaper.overlay === "string") root.classList.add(`boot-overlay-${wallpaper.overlay}`);
    if (typeof settings.theme?.accentColor === "string") root.style.setProperty("--boot-accent", settings.theme.accentColor);
    if (typeof settings.theme?.iconOpacity === "number") root.style.setProperty("--boot-icon-opacity", String(settings.theme.iconOpacity));
    if (typeof settings.theme?.panelTransparency === "number") root.style.setProperty("--boot-panel-alpha", String(settings.theme.panelTransparency));
    if (settings.search?.visibility === "hidden") root.classList.add("boot-search-hidden");
    if (settings.search?.visibility === "hover") root.classList.add("boot-search-hover");
    if (settings.search?.style === "solid" || settings.search?.style === "line") root.classList.add(`boot-search-${settings.search.style}`);
    if (settings.layout?.showShortcuts === false) root.classList.add("boot-shortcuts-hidden");
    if (settings.layout?.shortcutVisibility === "hidden") root.classList.add("boot-shortcuts-hidden");
    if (settings.layout?.shortcutVisibility === "hover") root.classList.add("boot-shortcuts-hover");
    if (settings.layout?.shortcutDensity === "compact" || settings.layout?.shortcutDensity === "dense") {
      root.classList.add(`boot-shortcuts-${settings.layout.shortcutDensity}`);
    }
    if (typeof settings.layout?.searchPosition === "string") root.classList.add(`boot-pos-${settings.layout.searchPosition}`);
  } catch {}
})();
