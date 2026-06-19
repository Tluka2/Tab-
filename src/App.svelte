<script lang="ts">
  import { onMount } from "svelte";
  import { BOOT_SETTINGS_KEY, defaultSettings, searchEngines } from "./lib/defaults";
  import { loadSettings, saveSettings } from "./lib/settings";
  import type { AppSettings, Shortcut, WallpaperItem } from "./lib/types";

  const commonSites = [
    { name: "Bilibili", url: "https://www.bilibili.com" },
    { name: "Google", url: "https://www.google.com" },
    { name: "YouTube", url: "https://www.youtube.com" },
    { name: "GitHub", url: "https://github.com" },
    { name: "Baidu", url: "https://www.baidu.com" },
    { name: "Bing", url: "https://www.bing.com" },
    { name: "Wikipedia", url: "https://www.wikipedia.org" },
    { name: "Reddit", url: "https://www.reddit.com" },
    { name: "Twitter/X", url: "https://x.com" },
    { name: "Instagram", url: "https://www.instagram.com" },
    { name: "知乎", url: "https://www.zhihu.com" },
    { name: "微博", url: "https://weibo.com" },
    { name: "淘宝", url: "https://www.taobao.com" },
    { name: "京东", url: "https://www.jd.com" },
    { name: "豆瓣", url: "https://www.douban.com" },
    { name: "抖音", url: "https://www.douyin.com" },
    { name: "Gmail", url: "https://mail.google.com" },
    { name: "Outlook", url: "https://outlook.live.com" },
    { name: "Stack Overflow", url: "https://stackoverflow.com" },
    { name: "MDN", url: "https://developer.mozilla.org" },
    { name: "ChatGPT", url: "https://chatgpt.com" },
    { name: "DeepSeek", url: "https://chat.deepseek.com" },
    { name: "豆包", url: "https://www.doubao.com" },
    { name: "Vercel", url: "https://vercel.com" },
    { name: "Netflix", url: "https://www.netflix.com" },
    { name: "Spotify", url: "https://open.spotify.com" },
    { name: "Notion", url: "https://www.notion.so" },
    { name: "Figma", url: "https://www.figma.com" },
    { name: "Canva", url: "https://www.canva.com" },
    { name: "Google Maps", url: "https://maps.google.com" },
    { name: "Google Translate", url: "https://translate.google.com" },
  ];
  import {
    deleteBrokenWallpapers,
    deleteWallpaper,
    getWallpaperBlob,
    getWallpaperStorageSummary,
    listWallpapers,
    saveWallpaper,
    updateWallpaper
  } from "./lib/wallpaperDb";
  import {
    fetchBingDailyWallpaper,
    getBootPreview,
    hashBlob,
    importLocalWallpaper,
    makeThumbnail,
    makeWallpaperPalette,
    objectUrlFromBlob,
    storeBootPreview
  } from "./lib/wallpaper";

  const MAX_IMPORT_WALLPAPERS = 100;
  const MAX_IMPORT_WALLPAPER_BYTES = 25 * 1024 * 1024;
  const MAX_IMPORT_WALLPAPER_TOTAL_BYTES = 250 * 1024 * 1024;

  function loadBootSettings(): AppSettings {
    try {
      const raw = localStorage.getItem(BOOT_SETTINGS_KEY);
      if (!raw) return structuredClone(defaultSettings);
      const bootSettings = JSON.parse(raw) as Partial<AppSettings>;
      return {
        ...structuredClone(defaultSettings),
        theme: { ...defaultSettings.theme, ...bootSettings.theme },
        wallpaper: { ...defaultSettings.wallpaper, ...bootSettings.wallpaper },
        search: { ...defaultSettings.search, ...bootSettings.search },
        layout: { ...defaultSettings.layout, ...bootSettings.layout },
        keyboard: { ...defaultSettings.keyboard, ...bootSettings.keyboard }
      };
    } catch {
      return structuredClone(defaultSettings);
    }
  }

  let settings: AppSettings = loadBootSettings();
  let wallpapers: WallpaperItem[] = [];
  let activeWallpaperUrl = "";
  let ambientWallpaperBackground = "";
  let wallpaperLoading = true;
  let preheatedWallpaperId = "";
  let preheatedWallpaperUrl = "";
  let preheatedWallpaperPromise: Promise<void> = Promise.resolve();
  let searchQuery = "";
  let settingsOpen = false;
  let shortcutDialogOpen = false;
  let editingShortcut: Shortcut | undefined;
  let shortcutDraft = { name: "", url: "", icon: "", group: "" };
  let searchInput: HTMLInputElement;
  let searchFormEl: HTMLDivElement;
  let status = "";
  let draggedShortcutId = "";
  let managedDraggedShortcutId = "";
  let wallpaperSummary = { count: 0, bytes: 0, missing: 0 };
  let systemPrefersLight = false;
  let editingWallpaper: WallpaperItem | undefined;
  let wallpaperOverrideQueue: Promise<void> = Promise.resolve();

  type WallpaperApplyOptions = {
    persistActiveId?: boolean;
    updateMetadata?: boolean;
    computePalette?: boolean;
  };

  $: sortedShortcuts = [...settings.shortcuts].sort((a, b) => a.order - b.order);
  $: shortcutGroups = groupShortcuts(sortedShortcuts);
  $: activeWallpaperItem = wallpapers.find((item) => item.id === settings.wallpaper.activeId);
  $: editingWallpaperCurrent = editingWallpaper
    ? wallpapers.find((item) => item.id === editingWallpaper?.id) ?? editingWallpaper
    : undefined;
  $: activeWallpaperDisplay = {
    fit: activeWallpaperItem?.fit ?? settings.wallpaper.fit,
    position: activeWallpaperItem?.position ?? settings.wallpaper.position,
    blur: activeWallpaperItem?.blur ?? settings.wallpaper.blur,
    dim: activeWallpaperItem?.dim ?? settings.wallpaper.dim,
    brightness: activeWallpaperItem?.brightness ?? settings.wallpaper.brightness,
    overlay: activeWallpaperItem?.overlay ?? settings.wallpaper.overlay
  };
  $: activeEngine = searchEngines.find((engine) => engine.id === settings.search.engineId) ?? searchEngines[0];
  $: searchTemplate =
    settings.search.engineId === "custom" ? settings.search.customTemplate : activeEngine.template;
  $: appTheme = settings.theme.mode === "auto" ? (systemPrefersLight ? "light" : "dark") : settings.theme.mode;
  $: backgroundStyle = [
    `--wallpaper-url: ${activeWallpaperUrl ? `url("${activeWallpaperUrl}")` : "var(--boot-wallpaper, none)"}`,
    `--ambient-wallpaper-bg: ${ambientWallpaperBackground || "var(--boot-wallpaper, none)"}`,
    `--wallpaper-position: ${activeWallpaperDisplay.position}`,
    `--wallpaper-blur: ${activeWallpaperDisplay.blur}px`,
    `--wallpaper-dim: ${activeWallpaperDisplay.dim}`,
    `--wallpaper-brightness: ${activeWallpaperDisplay.brightness}`,
    `--accent: ${settings.theme.accentColor}`,
    `--icon-opacity: ${settings.theme.iconOpacity}`,
    `--panel-alpha: ${settings.theme.panelTransparency}`
  ].join(";");

  async function waitForImageDecode(url: string, timeoutMs = 1200): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const image = new Image();
      image.decoding = "async";
      image.onload = done;
      image.onerror = done;
      image.src = url;
      if (image.decode) {
        void image.decode().then(done, done);
      }
      window.setTimeout(done, timeoutMs);
    });
  }

  onMount(() => {
    const systemThemeMatcher = window.matchMedia?.("(prefers-color-scheme: light)");
    const syncSystemTheme = () => {
      systemPrefersLight = Boolean(systemThemeMatcher?.matches);
    };
    syncSystemTheme();
    systemThemeMatcher?.addEventListener?.("change", syncSystemTheme);
    requestAnimationFrame(() => void initialize());
    window.addEventListener("keydown", handleGlobalKeydown);
    return () => {
      systemThemeMatcher?.removeEventListener?.("change", syncSystemTheme);
      window.removeEventListener("keydown", handleGlobalKeydown);
    };
  });

  async function initialize(): Promise<void> {
    settings = await loadSettings();
    wallpapers = await listWallpapers();
    runWhenIdle(() => void resolveActiveWallpaper({ startup: true }));
    runWhenIdle(() => void backfillWallpaperPreviews());
  }

  function runWhenIdle(task: () => void): void {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (idleWindow.requestIdleCallback) {
      idleWindow.requestIdleCallback(task, { timeout: 1500 });
      return;
    }
    window.setTimeout(task, 120);
  }

  async function persist(next = settings): Promise<void> {
    settings = await saveSettings(next);
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
  }

  async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
    const response = await fetch(dataUrl);
    return response.blob();
  }

  async function dataUrlToImageBlob(dataUrl: string): Promise<Blob> {
    const blob = await dataUrlToBlob(dataUrl);
    if (!blob.type.startsWith("image/")) throw new Error("Imported wallpaper is not an image");
    return blob;
  }

  function normalizeImportedWallpaperItem(item: Record<string, unknown>): WallpaperItem {
    const id = typeof item.id === "string" ? item.id : crypto.randomUUID();
    const source = item.source === "bing" ? "bing" : "local";
    return {
      id,
      name: (typeof item.name === "string" ? item.name : source === "bing" ? "Bing 每日壁纸" : "本地壁纸").slice(0, 120),
      source,
      blobId: typeof item.blobId === "string" ? item.blobId : `blob-${id}`,
      thumbDataUrl:
        typeof item.thumbDataUrl === "string" && item.thumbDataUrl.startsWith("data:image/")
          ? item.thumbDataUrl
          : undefined,
      previewDataUrl:
        typeof item.previewDataUrl === "string" && item.previewDataUrl.startsWith("data:image/")
          ? item.previewDataUrl
          : undefined,
      createdAt:
        typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
          ? Math.min(Date.now(), Math.max(0, item.createdAt))
          : Date.now(),
      lastUsedAt: typeof item.lastUsedAt === "number" ? item.lastUsedAt : undefined,
      attribution: typeof item.attribution === "string" ? item.attribution.slice(0, 500) : undefined,
      contentHash: typeof item.contentHash === "string" ? item.contentHash.slice(0, 128) : undefined,
      fit: ["cover", "contain", "fill", "blur", "ambient"].includes(String(item.fit)) ? (item.fit as WallpaperItem["fit"]) : undefined,
      position: ["center", "top", "bottom", "left", "right"].includes(String(item.position))
        ? (item.position as WallpaperItem["position"])
        : undefined,
      blur: typeof item.blur === "number" ? Math.min(24, Math.max(0, item.blur)) : undefined,
      dim: typeof item.dim === "number" ? Math.min(0.75, Math.max(0, item.dim)) : undefined,
      brightness: typeof item.brightness === "number" ? Math.min(1.25, Math.max(0.55, item.brightness)) : undefined,
      overlay: ["none", "vignette", "soft"].includes(String(item.overlay)) ? (item.overlay as WallpaperItem["overlay"]) : undefined
    };
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function groupShortcuts(shortcuts: Shortcut[]): Array<{ name: string; shortcuts: Shortcut[] }> {
    const groups = new Map<string, Shortcut[]>();
    for (const shortcut of shortcuts) {
      const groupName = shortcut.group?.trim() || "";
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName)!.push(shortcut);
    }
    return Array.from(groups.entries()).map(([name, groupShortcuts]) => ({ name, shortcuts: groupShortcuts }));
  }

  async function refreshWallpaperSummary(): Promise<void> {
    wallpaperSummary = await getWallpaperStorageSummary();
  }

  async function backfillWallpaperPreviews(limit = 3): Promise<void> {
    wallpapers = await listWallpapers();
    let updated = 0;
    for (const item of wallpapers) {
      if (updated >= limit) break;
      if (item.previewDataUrl) continue;
      const blob = await getWallpaperBlob(item.blobId);
      if (!blob) continue;
      const previewDataUrl = await makeThumbnail(blob, 640, 0.62);
      const nextItem = { ...item, previewDataUrl };
        await updateWallpaper(nextItem);
        wallpapers = wallpapers.map((wallpaper) => (wallpaper.id === nextItem.id ? nextItem : wallpaper));
        if (settings.wallpaper.activeId === nextItem.id) {
          storeBootPreview(previewDataUrl, { persist: settings.wallpaper.source !== "rotation" });
          primeNextRotationBootPreview();
        }
      updated += 1;
    }
    if (updated > 0) await refreshWallpaperSummary();
  }

  function openSettingsPanel(): void {
    settingsOpen = true;
    void refreshWallpaperSummary();
  }

  async function exportSettings(): Promise<void> {
    const exportedWallpapers = [];
    for (const item of wallpapers) {
      const blob = await getWallpaperBlob(item.blobId);
      if (blob) {
        exportedWallpapers.push({
          item,
          dataUrl: await blobToDataUrl(blob)
        });
      }
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      app: "Tab",
      settings,
      wallpapers: exportedWallpapers
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tab-settings-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importSettings(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as unknown;
      const imported = isRecord(parsed) && parsed.settings ? parsed.settings : parsed;
      if (isRecord(parsed) && Array.isArray(parsed.wallpapers)) {
        let importedWallpaperBytes = 0;
        for (const entry of parsed.wallpapers.slice(0, MAX_IMPORT_WALLPAPERS)) {
          if (!isRecord(entry) || !isRecord(entry.item) || typeof entry.dataUrl !== "string") continue;
          try {
            const blob = await dataUrlToImageBlob(entry.dataUrl);
            if (blob.size > MAX_IMPORT_WALLPAPER_BYTES) continue;
            if (importedWallpaperBytes + blob.size > MAX_IMPORT_WALLPAPER_TOTAL_BYTES) break;
            await saveWallpaper(normalizeImportedWallpaperItem(entry.item), blob);
            importedWallpaperBytes += blob.size;
          } catch {
            // Skip invalid wallpaper package entries; settings can still be restored.
          }
        }
      }
      await persist(imported as AppSettings);
      wallpapers = await listWallpapers();
      await refreshWallpaperSummary();
      await resolveActiveWallpaper();
      status = "设置已导入。";
    } catch {
      status = "无法导入设置 JSON。";
    } finally {
      input.value = "";
    }
  }

  async function persistCustomTemplate(): Promise<void> {
    if (!settings.search.customTemplate.includes("{query}")) {
      status = "自定义搜索模板必须包含 {query}，已恢复默认值。";
    }
    await persist();
  }

  function normalizeUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^[a-z]+:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }

  function faviconFor(url: string): string {
    try {
      const parsed = new URL(normalizeUrl(url));
      return `${parsed.origin}/favicon.ico`;
    } catch {
      return "";
    }
  }

  function openInNewTab(url: string): void {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function navigateToSearch(): void {
    const value = searchQuery.trim();
    if (!value) return;
    const looksLikeUrl = /^([a-z]+:\/\/)?([\w-]+\.)+[\w-]{2,}(\/.*)?$/i.test(value);
    const target = looksLikeUrl
      ? normalizeUrl(value)
      : searchTemplate.replace("{query}", encodeURIComponent(value));
    openInNewTab(target);
  }

  async function applyLayoutPreset(preset: "minimal" | "balanced" | "quick"): Promise<void> {
    const presets = {
      minimal: {
        search: { ...settings.search, visibility: "hover" as const, style: "line" as const },
        layout: { ...settings.layout, searchPosition: "center" as const, showShortcuts: false, shortcutVisibility: "hidden" as const },
        theme: { ...settings.theme, panelTransparency: 0.62 }
      },
      balanced: {
        search: { ...settings.search, visibility: "always" as const, style: "glass" as const },
        layout: {
          ...settings.layout,
          searchPosition: "center" as const,
          showShortcuts: true,
          shortcutDensity: "comfortable" as const,
          shortcutVisibility: "always" as const
        },
        theme: { ...settings.theme, panelTransparency: 0.72 }
      },
      quick: {
        search: { ...settings.search, visibility: "always" as const, style: "glass" as const },
        layout: {
          ...settings.layout,
          searchPosition: "upper" as const,
          showShortcuts: true,
          shortcutDensity: "dense" as const,
          shortcutVisibility: "always" as const
        },
        theme: { ...settings.theme, panelTransparency: 0.82 }
      }
    };
    await persist({ ...settings, ...presets[preset] });
    status = `已应用${preset === "minimal" ? "极简" : preset === "quick" ? "快捷入口" : "平衡"}布局。`;
  }

  function handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") navigateToSearch();
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    return Boolean(
      element?.closest("input, textarea, select, [contenteditable='true']")
    );
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      settingsOpen = false;
      shortcutDialogOpen = false;
      return;
    }

    if (isTypingTarget(event.target)) return;

    if (settings.keyboard.focusSearch && (event.key === "/" || (event.ctrlKey && event.key.toLowerCase() === "k"))) {
      event.preventDefault();
      searchFormEl?.classList.add("focus-visible");
      searchInput?.focus();
      return;
    }

    if (settings.keyboard.numberShortcuts && /^[1-9]$/.test(event.key)) {
      const shortcut = sortedShortcuts[Number(event.key) - 1];
      if (shortcut) openInNewTab(shortcut.url);
    }
  }

  async function resolveActiveWallpaper(options: { startup?: boolean } = {}): Promise<void> {
    if (settings.wallpaper.source === "rotation") {
      const nextRotationItem = getNextRotationItem();
      if (nextRotationItem) {
        await applyRotationWallpaper(nextRotationItem, {
          updateMetadata: !options.startup,
          computePalette: false
        });
        return;
      }
    }

    const preferred =
      wallpapers.find((item) => item.id === settings.wallpaper.activeId) ??
      wallpapers.find((item) => settings.wallpaper.source !== "rotation" && item.source === settings.wallpaper.source) ??
      wallpapers[0];

    if (preferred) {
      await setActiveWallpaper(preferred, {
        persistActiveId: !options.startup && preferred.id !== settings.wallpaper.activeId,
        updateMetadata: !options.startup,
        computePalette: false
      });
      return;
    }

    if (settings.wallpaper.source === "bing") {
      if (options.startup) runWhenIdle(() => void refreshBingWallpaper());
      else await refreshBingWallpaper();
    }
  }

  async function applyRotationWallpaper(item: WallpaperItem, options: Pick<WallpaperApplyOptions, "updateMetadata" | "computePalette"> = {}): Promise<void> {
    await setActiveWallpaper(item, {
      persistActiveId: false,
      updateMetadata: options.updateMetadata ?? true,
      computePalette: options.computePalette ?? false
    });
    await persist({
      ...settings,
      wallpaper: {
        ...settings.wallpaper,
        source: "rotation",
        ...buildRotationState(item.id)
      }
    });
    primeNextRotationBootPreview();
  }

  function getRotationItems(): WallpaperItem[] {
    return settings.wallpaper.rotationIds
      .map((id) => wallpapers.find((item) => item.id === id))
      .filter((item): item is WallpaperItem => Boolean(item));
  }

  function getRotationStatusText(): string {
    const count = getRotationItems().length;
    if (count >= 3) return `轮换池 ${count} 张：随机选择，任意连续 3 次不重复。`;
    if (count === 2) return "轮换池 2 张：会避免连续重复；至少 3 张可保证三张内不重复。";
    if (count === 1) return "轮换池 1 张：至少选择 3 张可保证三张内不重复。";
    return "未选择轮换壁纸：至少选择 3 张可启用随机且三张内不重复。";
  }

  function getRotationRecentLimit(): number {
    const rotationItems = getRotationItems();
    return Math.min(2, Math.max(0, rotationItems.length - 1));
  }

  function getValidRotationRecentIds(): string[] {
    const rotationIds = new Set(getRotationItems().map((item) => item.id));
    const ids = [settings.wallpaper.activeId, ...settings.wallpaper.rotationRecentIds].filter(Boolean) as string[];
    return Array.from(new Set(ids.filter((id) => rotationIds.has(id)))).slice(0, getRotationRecentLimit());
  }

  function getRandomIndex(max: number): number {
    if (max <= 1) return 0;
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % max;
  }

  function chooseRandomRotationItem(excludeIds: string[] = []): WallpaperItem | undefined {
    const rotationItems = getRotationItems();
    if (rotationItems.length === 0) return undefined;
    const excluded = new Set(excludeIds);
    const candidates = rotationItems.filter((item) => !excluded.has(item.id));
    const pool = candidates.length > 0 ? candidates : rotationItems;
    return pool[getRandomIndex(pool.length)];
  }

  function getQueuedRotationItem(): WallpaperItem | undefined {
    return getRotationItems().find((item) => item.id === settings.wallpaper.rotationNextId);
  }

  function getNextRotationItem(): WallpaperItem | undefined {
    return getQueuedRotationItem() ?? chooseRandomRotationItem(getValidRotationRecentIds());
  }

  function buildRotationState(activeId: string): Pick<AppSettings["wallpaper"], "activeId" | "rotationRecentIds" | "rotationNextId"> {
    const rotationIds = new Set(getRotationItems().map((item) => item.id));
    const rotationRecentIds = Array.from(
      new Set([activeId, ...settings.wallpaper.rotationRecentIds].filter((id): id is string => Boolean(id) && rotationIds.has(id)))
    ).slice(0, getRotationRecentLimit());
    const nextItem = chooseRandomRotationItem(rotationRecentIds);
    return {
      activeId,
      rotationRecentIds,
      rotationNextId: nextItem?.id
    };
  }

  function sanitizeRotationState(
    wallpaperSettings: AppSettings["wallpaper"],
    availableWallpapers: WallpaperItem[] = wallpapers
  ): AppSettings["wallpaper"] {
    const availableIds = new Set(availableWallpapers.map((item) => item.id));
    const rotationIds = Array.from(new Set(wallpaperSettings.rotationIds.filter((id) => availableIds.has(id))));
    const rotationSet = new Set(rotationIds);
    const activeId =
      wallpaperSettings.activeId && availableIds.has(wallpaperSettings.activeId)
        ? wallpaperSettings.activeId
        : availableWallpapers[0]?.id;
    const limit = Math.min(2, Math.max(0, rotationIds.length - 1));
    const rotationRecentIds = Array.from(
      new Set(wallpaperSettings.rotationRecentIds.filter((id) => rotationSet.has(id)))
    ).slice(0, limit);
    const rotationNextId = wallpaperSettings.rotationNextId && rotationSet.has(wallpaperSettings.rotationNextId)
      ? wallpaperSettings.rotationNextId
      : undefined;
    return {
      ...wallpaperSettings,
      activeId,
      rotationIds,
      rotationRecentIds,
      rotationNextId
    };
  }

  function primeNextRotationBootPreview(): void {
    if (settings.wallpaper.source !== "rotation") {
      releasePreheatedWallpaper();
      return;
    }
    const nextPreview = getQueuedRotationItem() ?? chooseRandomRotationItem(getValidRotationRecentIds());
    const preview = nextPreview ? getBootPreview(nextPreview) : undefined;
    if (preview) storeBootPreview(preview, { applyToPage: false });
    schedulePreheatNextRotationWallpaper(nextPreview);
  }

  function emitWallpaperPreheatEvent(type: "ready" | "consume", itemId: string): void {
    window.dispatchEvent(new CustomEvent("tab-wallpaper-preheat", { detail: { type, itemId } }));
  }

  function releasePreheatedWallpaper(keepUrl = ""): void {
    if (preheatedWallpaperUrl && preheatedWallpaperUrl !== keepUrl) {
      URL.revokeObjectURL(preheatedWallpaperUrl);
    }
    preheatedWallpaperId = "";
    preheatedWallpaperUrl = "";
  }

  function consumePreheatedWallpaper(itemId: string): string | undefined {
    if (preheatedWallpaperId !== itemId || !preheatedWallpaperUrl) return undefined;
    const url = preheatedWallpaperUrl;
    preheatedWallpaperId = "";
    preheatedWallpaperUrl = "";
    emitWallpaperPreheatEvent("consume", itemId);
    return url;
  }

  function schedulePreheatNextRotationWallpaper(nextItem = getQueuedRotationItem()): void {
    if (!nextItem) {
      releasePreheatedWallpaper();
      return;
    }
    if (preheatedWallpaperId === nextItem.id && preheatedWallpaperUrl) return;
    preheatedWallpaperPromise = preheatedWallpaperPromise
      .then(() => preheatRotationWallpaper(nextItem))
      .catch(() => {});
  }

  async function preheatRotationWallpaper(item: WallpaperItem): Promise<void> {
    if (settings.wallpaper.source !== "rotation") {
      releasePreheatedWallpaper();
      return;
    }
    const queuedItem = getQueuedRotationItem();
    if (!queuedItem || queuedItem.id !== item.id) return;
    const blob = await getWallpaperBlob(item.blobId);
    if (!blob) return;
    const url = objectUrlFromBlob(blob);
    await waitForImageDecode(url, 1800);
    const stillQueued = settings.wallpaper.source === "rotation" && getQueuedRotationItem()?.id === item.id;
    if (!stillQueued) {
      URL.revokeObjectURL(url);
      return;
    }
    releasePreheatedWallpaper(url);
    preheatedWallpaperId = item.id;
    preheatedWallpaperUrl = url;
    emitWallpaperPreheatEvent("ready", item.id);
  }

  async function setActiveWallpaper(
    item: WallpaperItem,
    options: WallpaperApplyOptions | boolean = {}
  ): Promise<void> {
    const normalizedOptions: WallpaperApplyOptions =
      typeof options === "boolean"
        ? { persistActiveId: options, updateMetadata: true, computePalette: true }
        : {
            persistActiveId: options.persistActiveId ?? true,
            updateMetadata: options.updateMetadata ?? true,
            computePalette: options.computePalette ?? true
          };
    const blob = await getWallpaperBlob(item.blobId);
    if (!blob) return;
    const previousUrl = activeWallpaperUrl;
    const preheatedUrl = consumePreheatedWallpaper(item.id);
    const nextUrl = preheatedUrl ?? objectUrlFromBlob(blob);
    storeBootPreview(getBootPreview(item), { persist: settings.wallpaper.source !== "rotation" });
    wallpaperLoading = true;
    if (!preheatedUrl) await waitForImageDecode(nextUrl);
    activeWallpaperUrl = nextUrl;
    wallpaperLoading = false;
    if (previousUrl.startsWith("blob:")) {
      window.setTimeout(() => URL.revokeObjectURL(previousUrl), 250);
    }
    if (normalizedOptions.computePalette) {
      const palette = await makeWallpaperPalette(blob);
      ambientWallpaperBackground = [
        `radial-gradient(circle at 18% 12%, ${palette[0]} 0, transparent 34%)`,
        `radial-gradient(circle at 82% 78%, ${palette[1] ?? palette[0]} 0, transparent 36%)`,
        `linear-gradient(135deg, ${palette[2] ?? palette[0]}, #080d0e)`
      ].join(",");
    } else {
      runWhenIdle(() => {
        void makeWallpaperPalette(blob).then((palette) => {
          ambientWallpaperBackground = [
            `radial-gradient(circle at 18% 12%, ${palette[0]} 0, transparent 34%)`,
            `radial-gradient(circle at 82% 78%, ${palette[1] ?? palette[0]} 0, transparent 36%)`,
            `linear-gradient(135deg, ${palette[2] ?? palette[0]}, #080d0e)`
          ].join(",");
        });
      });
    }
    if (normalizedOptions.updateMetadata) {
      item.lastUsedAt = Date.now();
      await updateWallpaper(item);
    }
    if (!item.previewDataUrl) {
      runWhenIdle(() => {
        void makeThumbnail(blob, 640, 0.62).then(async (previewDataUrl) => {
          const nextItem = { ...item, previewDataUrl };
          await updateWallpaper(nextItem);
          wallpapers = wallpapers.map((wallpaper) => (wallpaper.id === nextItem.id ? nextItem : wallpaper));
          if (settings.wallpaper.activeId === nextItem.id) {
            storeBootPreview(previewDataUrl, { persist: settings.wallpaper.source !== "rotation" });
            primeNextRotationBootPreview();
          }
        });
      });
    }
    if (normalizedOptions.persistActiveId) {
      await persist({
        ...settings,
        wallpaper: { ...settings.wallpaper, activeId: item.id }
      });
    }
    primeNextRotationBootPreview();
  }

  async function useWallpaperSource(source: AppSettings["wallpaper"]["source"]): Promise<void> {
    const shouldWaitForWallpaper = source === "rotation" && getRotationItems().length > 0;
    if (shouldWaitForWallpaper) wallpaperLoading = true;
    await persist({
      ...settings,
      wallpaper: { ...settings.wallpaper, source }
    });
    try {
      await resolveActiveWallpaper();
      primeNextRotationBootPreview();
    } finally {
      if (shouldWaitForWallpaper) wallpaperLoading = false;
    }
  }

  async function showNextRotationWallpaper(): Promise<void> {
    await persist({
      ...settings,
      wallpaper: { ...settings.wallpaper, source: "rotation" }
    });
    const nextRotationItem = getNextRotationItem();
    if (nextRotationItem) await applyRotationWallpaper(nextRotationItem);
  }

  async function toggleWallpaperRotation(item: WallpaperItem, enabled: boolean): Promise<void> {
    const rotationIds = enabled
      ? Array.from(new Set([...settings.wallpaper.rotationIds, item.id]))
      : settings.wallpaper.rotationIds.filter((id) => id !== item.id);
    await persist({
      ...settings,
      wallpaper: sanitizeRotationState({ ...settings.wallpaper, rotationIds })
    });
    primeNextRotationBootPreview();
  }

  async function refreshBingWallpaper(): Promise<void> {
    status = "正在获取 Bing 壁纸...";
    try {
      const item = await fetchBingDailyWallpaper();
      wallpapers = await listWallpapers();
      await refreshWallpaperSummary();
      await persist({
        ...settings,
        wallpaper: {
          ...settings.wallpaper,
          source: "bing",
          activeId: item.id,
          rotationIds: Array.from(new Set([...settings.wallpaper.rotationIds, item.id]))
        }
      });
      await setActiveWallpaper(item, { persistActiveId: false });
      status = "Bing 壁纸已缓存。";
    } catch (error) {
      status = error instanceof Error ? error.message : "无法获取 Bing 壁纸。";
    }
  }

  async function handleLocalWallpaper(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    status = "正在导入壁纸...";
    const item = await importLocalWallpaper(file);
    wallpapers = await listWallpapers();
    await refreshWallpaperSummary();
    await persist({
      ...settings,
      wallpaper: {
        ...settings.wallpaper,
        source: "local",
        activeId: item.id,
        rotationIds: Array.from(new Set([...settings.wallpaper.rotationIds, item.id]))
      }
    });
    await setActiveWallpaper(item, { persistActiveId: false });
    status = "本地壁纸已缓存。";
    input.value = "";
  }

  async function handleLocalWallpapers(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    status = "正在导入壁纸...";
    const existingHashes = new Set(wallpapers.map((item) => item.contentHash).filter((hash): hash is string => Boolean(hash)));
    const importedItems: WallpaperItem[] = [];
    let skipped = 0;
    for (const file of files) {
      const blob = file.slice(0, file.size, file.type || "image/jpeg");
      const contentHash = await hashBlob(blob);
      if (existingHashes.has(contentHash)) {
        skipped += 1;
        continue;
      }
      const item = await importLocalWallpaper(file, { blob, contentHash });
      existingHashes.add(item.contentHash ?? contentHash);
      importedItems.push(item);
    }
    if (importedItems.length === 0) {
      status = skipped > 0 ? `已跳过 ${skipped} 张重复壁纸。` : "没有可导入的图片。";
      input.value = "";
      return;
    }
    wallpapers = await listWallpapers();
    await refreshWallpaperSummary();
    const activeItem = importedItems[0];
    await persist({
      ...settings,
      wallpaper: {
        ...settings.wallpaper,
        source: "local",
        activeId: activeItem.id,
        rotationIds: Array.from(new Set([...settings.wallpaper.rotationIds, ...importedItems.map((item) => item.id)]))
      }
    });
    await setActiveWallpaper(activeItem, { persistActiveId: false });
    status = `已导入 ${importedItems.length} 张壁纸${skipped > 0 ? `，跳过 ${skipped} 张重复图片` : ""}。`;
    input.value = "";
  }

  async function removeWallpaper(item: WallpaperItem): Promise<void> {
    if (preheatedWallpaperId === item.id) releasePreheatedWallpaper();
    await deleteWallpaper(item);
    wallpapers = await listWallpapers();
    await refreshWallpaperSummary();
    const nextActive = wallpapers[0];
    const nextWallpaperSettings = sanitizeRotationState(
      {
        ...settings.wallpaper,
        activeId: nextActive?.id,
        rotationIds: settings.wallpaper.rotationIds.filter((id) => id !== item.id)
      },
      wallpapers
    );
    await persist({
      ...settings,
      wallpaper: nextWallpaperSettings
    });
    if (nextActive) await setActiveWallpaper(nextActive, { persistActiveId: false });
    else activeWallpaperUrl = "";
  }

  async function cleanupBrokenWallpapers(): Promise<void> {
    const deleted = await deleteBrokenWallpapers();
    wallpapers = await listWallpapers();
    await refreshWallpaperSummary();
    await persist({
      ...settings,
      wallpaper: sanitizeRotationState(settings.wallpaper, wallpapers)
    });
    await resolveActiveWallpaper();
    status = deleted > 0 ? `已清理 ${deleted} 个不可用壁纸记录。` : "没有发现不可用壁纸记录。";
  }

  async function updateWallpaperOverrides(item: WallpaperItem, patch: Partial<WallpaperItem>): Promise<void> {
    wallpaperOverrideQueue = wallpaperOverrideQueue.then(async () => {
      const current = wallpapers.find((wallpaper) => wallpaper.id === item.id) ?? item;
      const next = { ...current, ...patch };
      await updateWallpaper(next);
      wallpapers = wallpapers.map((wallpaper) => (wallpaper.id === item.id ? next : wallpaper));
    });
    return wallpaperOverrideQueue;
  }

  async function resetWallpaperOverrides(item: WallpaperItem): Promise<void> {
    wallpaperOverrideQueue = wallpaperOverrideQueue.then(async () => {
      const current = wallpapers.find((wallpaper) => wallpaper.id === item.id) ?? item;
      const { fit, position, blur, dim, brightness, overlay, ...next } = current;
      await updateWallpaper(next);
      wallpapers = wallpapers.map((wallpaper) => (wallpaper.id === item.id ? next : wallpaper));
    });
    return wallpaperOverrideQueue;
  }

  function openShortcutDialog(shortcut?: Shortcut): void {
    editingShortcut = shortcut;
    shortcutDraft = {
      name: shortcut?.name ?? "",
      url: shortcut?.url ?? "",
      icon: shortcut?.icon ?? "",
      group: shortcut?.group ?? ""
    };
    shortcutDialogOpen = true;
  }

  async function saveShortcut(): Promise<void> {
    const url = normalizeUrl(shortcutDraft.url);
    if (!shortcutDraft.name.trim() || !url) return;
    const nextShortcuts = editingShortcut
      ? settings.shortcuts.map((item) =>
          item.id === editingShortcut?.id
            ? {
                ...item,
                name: shortcutDraft.name.trim(),
                url,
                group: shortcutDraft.group.trim() || undefined,
                icon: shortcutDraft.icon.trim() || faviconFor(url)
              }
            : item
        )
      : [
          ...settings.shortcuts,
          {
            id: crypto.randomUUID(),
            name: shortcutDraft.name.trim(),
            url,
            group: shortcutDraft.group.trim() || undefined,
            icon: shortcutDraft.icon.trim() || faviconFor(url),
            order: settings.shortcuts.length
          }
        ];
    await persist({ ...settings, shortcuts: nextShortcuts });
    shortcutDialogOpen = false;
  }

  async function deleteShortcut(shortcut: Shortcut): Promise<void> {
    await persist({
      ...settings,
      shortcuts: settings.shortcuts
        .filter((item) => item.id !== shortcut.id)
        .map((item, index) => ({ ...item, order: index }))
    });
  }

  async function renameShortcutGroup(oldName: string, newName: string): Promise<void> {
    const normalized = newName.trim();
    if (!oldName || !normalized || normalized === oldName) return;
    await persist({
      ...settings,
      shortcuts: settings.shortcuts.map((shortcut) =>
        shortcut.group === oldName ? { ...shortcut, group: normalized } : shortcut
      )
    });
  }

  async function deleteShortcutGroup(groupName: string): Promise<void> {
    if (!groupName) return;
    await persist({
      ...settings,
      shortcuts: settings.shortcuts.map((shortcut) =>
        shortcut.group === groupName ? { ...shortcut, group: undefined } : shortcut
      )
    });
  }

  async function moveShortcutToGroup(groupName: string): Promise<void> {
    if (!managedDraggedShortcutId) return;
    await persist({
      ...settings,
      shortcuts: settings.shortcuts.map((shortcut) =>
        shortcut.id === managedDraggedShortcutId ? { ...shortcut, group: groupName || undefined } : shortcut
      )
    });
    managedDraggedShortcutId = "";
  }

  async function reorderShortcut(targetId: string): Promise<void> {
    if (!draggedShortcutId || draggedShortcutId === targetId) return;
    const next = [...sortedShortcuts];
    const from = next.findIndex((item) => item.id === draggedShortcutId);
    const to = next.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    await persist({ ...settings, shortcuts: next.map((item, index) => ({ ...item, order: index })) });
  }

  async function clearShortcutIcon(shortcut: Shortcut): Promise<void> {
    await persist({
      ...settings,
      shortcuts: settings.shortcuts.map((item) => (item.id === shortcut.id ? { ...item, icon: undefined } : item))
    });
  }
</script>

<svelte:head>
  <title>新标签页</title>
</svelte:head>

<main class:theme-light={appTheme === "light"} class:theme-dark={appTheme === "dark"} class:wallpaper-loading={wallpaperLoading} style={backgroundStyle}>
  <div class="wallpaper-back"></div>
  <div class="wallpaper-blur-fill" class:visible={activeWallpaperDisplay.fit === "blur"}></div>
  <div class="wallpaper-ambient-fill" class:visible={activeWallpaperDisplay.fit === "ambient"}></div>
  <div class="wallpaper" class:overlay-soft={activeWallpaperDisplay.overlay === "soft"} class:overlay-vignette={activeWallpaperDisplay.overlay === "vignette"} class:fit-cover={activeWallpaperDisplay.fit === "cover"} class:fit-contain={activeWallpaperDisplay.fit === "contain"} class:fit-fill={activeWallpaperDisplay.fit === "fill"} class:fit-blur={activeWallpaperDisplay.fit === "blur"} class:fit-ambient={activeWallpaperDisplay.fit === "ambient"}></div>

  <section class:pos-upper={settings.layout.searchPosition === "upper"} class:pos-center={settings.layout.searchPosition === "center"} class:pos-lower={settings.layout.searchPosition === "lower"} class="workspace">
    <div bind:this={searchFormEl} class:solid={settings.search.style === "solid"} class:line={settings.search.style === "line"} class:visibility-hover={settings.search.visibility === "hover"} class:visibility-hidden={settings.search.visibility === "hidden"} class="search-shell">
      <input
        bind:this={searchInput}
        bind:value={searchQuery}
        aria-label="搜索"
        autocomplete="off"
        placeholder={settings.search.placeholder}
        spellcheck="false"
        on:keydown={handleSearchKeydown}
        on:blur={() => searchFormEl?.classList.remove("focus-visible")}
        on:focus={() => searchFormEl?.classList.add("focus-visible")}
      />
      <button aria-label="搜索" on:click={navigateToSearch}>搜索</button>
      {#if searchQuery.trim()}
        {@const lower = searchQuery.trim().toLowerCase()}
        {@const shortcutMatches = sortedShortcuts.filter((s) => s.name.toLowerCase().includes(lower) || s.url.toLowerCase().includes(lower))}
        {@const shortcutUrls = new Set(shortcutMatches.map((s) => s.url))}
        {@const commonMatches = commonSites.filter((s) => !shortcutUrls.has(s.url) && (s.name.toLowerCase().includes(lower) || s.url.toLowerCase().includes(lower)))}
        {@const matches = [...shortcutMatches.map((s) => ({ name: s.name, url: s.url, icon: s.icon })), ...commonMatches.map((s) => ({ ...s, icon: undefined }))]}
        {#if matches.length > 0}
          <div class="search-suggestions">
            {#each matches as shortcut}
              <button type="button" on:click|preventDefault={() => openInNewTab(shortcut.url)}>
                {#if shortcut.icon}
                  <img alt="" src={shortcut.icon} />
                {/if}
                <span>{shortcut.name}</span>
                <span class="suggestion-url">{shortcut.url}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    {#if settings.layout.showShortcuts}
      <div class:density-compact={settings.layout.shortcutDensity === "compact"} class:density-dense={settings.layout.shortcutDensity === "dense"} class:visibility-hover={settings.layout.shortcutVisibility === "hover"} class:visibility-hidden={settings.layout.shortcutVisibility === "hidden"} class="shortcuts">
        {#each shortcutGroups as group}
          {#if group.name}
            <h3 class="shortcut-group-title">{group.name}</h3>
          {/if}
          {#each group.shortcuts as shortcut (shortcut.id)}
            {@const index = sortedShortcuts.findIndex((item) => item.id === shortcut.id)}
            <a
              class="shortcut"
              draggable="true"
              href={shortcut.url}
              rel="noreferrer"
              target="_blank"
              on:dragstart={() => (draggedShortcutId = shortcut.id)}
              on:dragover|preventDefault
              on:drop|preventDefault={() => reorderShortcut(shortcut.id)}
            >
              <span class="shortcut-index">{index + 1}</span>
              {#if shortcut.icon}
                <img alt="" src={shortcut.icon} on:error={() => clearShortcutIcon(shortcut)} />
              {:else}
                <span class="fallback-icon">{shortcut.name.slice(0, 1).toUpperCase()}</span>
              {/if}
              <span>{shortcut.name}</span>
            </a>
          {/each}
        {/each}
      </div>
    {/if}
  </section>

  <button class="settings-button" aria-label="打开设置" on:click={openSettingsPanel}>设置</button>

  {#if activeWallpaperItem?.attribution}
    <p class="wallpaper-attribution">{activeWallpaperItem.attribution}</p>
  {/if}

  {#if settingsOpen}
    <aside class="panel" aria-label="设置面板">
      <header>
        <h2>设置</h2>
        <button aria-label="关闭设置" on:click={() => (settingsOpen = false)}>关闭</button>
      </header>

      <div class="panel-section">
        <h3>壁纸</h3>
        <div class="button-row">
          <button on:click={refreshBingWallpaper}>Bing 每日壁纸</button>
          <label class="file-button">
            上传
            <input accept="image/*" multiple type="file" on:change={handleLocalWallpapers} />
          </label>
          <button on:click={showNextRotationWallpaper}>下一张</button>
        </div>
        <label>
          来源
          <select value={settings.wallpaper.source} on:change={(event) => useWallpaperSource(event.currentTarget.value as AppSettings["wallpaper"]["source"])}>
            <option value="bing">Bing 每日壁纸</option>
            <option value="local">本地</option>
            <option value="rotation">轮换</option>
          </select>
        </label>
        {#if status}<p class="status">{status}</p>{/if}
        <p class="status">
          壁纸 {wallpaperSummary.count} 张，占用 {formatBytes(wallpaperSummary.bytes)}
          {#if wallpaperSummary.missing > 0}
            ，{wallpaperSummary.missing} 个记录缺少图片数据
          {/if}
        </p>
        <button on:click={cleanupBrokenWallpapers}>清理不可用壁纸记录</button>
        <p id="rotationStatus" class="status rotation-status">{getRotationStatusText()}</p>
        <div class="wallpaper-list">
          {#each wallpapers as item (item.id)}
            <div class="wallpaper-item wallpaper-choice" class:active={item.id === settings.wallpaper.activeId} data-wallpaper-id={item.id}>
              <button class="wallpaper-thumb-button" type="button" aria-label={`使用 ${item.name}`} on:click={() => setActiveWallpaper(item)}>
                {#if item.thumbDataUrl}<img alt="" src={item.thumbDataUrl} />{/if}
              </button>
              <span>{item.name}</span>
              <div class="wallpaper-item-actions">
                <label class="mini-check">
                  <input
                    checked={settings.wallpaper.rotationIds.includes(item.id)}
                    type="checkbox"
                    on:change={(event) => toggleWallpaperRotation(item, event.currentTarget.checked)}
                  />
                  轮换
                </label>
                <button class="wallpaper-more-button" type="button" on:click={() => (editingWallpaper = item)}>更多</button>
                <button class="small-danger" aria-label="删除壁纸" on:click={() => removeWallpaper(item)}>删除</button>
              </div>
            </div>
          {/each}
        </div>
        <label>模糊 <input type="range" min="0" max="24" bind:value={settings.wallpaper.blur} on:change={() => persist()} /></label>
        <label>变暗 <input type="range" min="0" max="0.75" step="0.01" bind:value={settings.wallpaper.dim} on:change={() => persist()} /></label>
        <label>亮度 <input type="range" min="0.55" max="1.25" step="0.01" bind:value={settings.wallpaper.brightness} on:change={() => persist()} /></label>
        <label>
          遮罩
          <select bind:value={settings.wallpaper.overlay} on:change={() => persist()}>
            <option value="soft">柔和</option>
            <option value="vignette">暗角</option>
            <option value="none">无</option>
          </select>
        </label>
        <label>
          铺满方式
          <select bind:value={settings.wallpaper.fit} on:change={() => persist()}>
            <option value="ambient">完整显示 + 主色背景</option>
            <option value="cover">裁切铺满</option>
            <option value="contain">完整显示</option>
            <option value="fill">拉伸填满</option>
            <option value="blur">模糊填充</option>
          </select>
        </label>
        <label>
          壁纸位置
          <select bind:value={settings.wallpaper.position} on:change={() => persist()}>
            <option value="center">居中</option>
            <option value="top">顶部</option>
            <option value="bottom">底部</option>
            <option value="left">左侧</option>
            <option value="right">右侧</option>
          </select>
        </label>
      </div>

      <div class="panel-section">
        <h3>搜索</h3>
        <label>
          搜索引擎
          <select bind:value={settings.search.engineId} on:change={() => persist()}>
            {#each searchEngines as engine}
              <option value={engine.id}>{engine.name}</option>
            {/each}
          </select>
        </label>
        {#if settings.search.engineId === "custom"}
          <label>模板 <input bind:value={settings.search.customTemplate} on:change={persistCustomTemplate} /></label>
        {/if}
        <label>占位文本 <input bind:value={settings.search.placeholder} on:change={() => persist()} /></label>
        <label>
          样式
          <select bind:value={settings.search.style} on:change={() => persist()}>
            <option value="glass">玻璃</option>
            <option value="solid">实色</option>
            <option value="line">线条</option>
          </select>
        </label>
        <label>
          显示
          <select bind:value={settings.search.visibility} on:change={() => persist()}>
            <option value="always">常亮</option>
            <option value="hover">悬停显示</option>
            <option value="hidden">隐藏</option>
          </select>
        </label>
      </div>

      <div class="panel-section">
        <h3>快捷方式</h3>
        <button on:click={() => openShortcutDialog()}>添加快捷方式</button>
        <details class="compact-details">
          <summary>管理已添加快捷方式（{sortedShortcuts.length}）</summary>
          <div class="shortcut-group-manager">
            {#each shortcutGroups as group}
              <section class="shortcut-manage-group" role="group" on:dragover|preventDefault on:drop|preventDefault={() => moveShortcutToGroup(group.name)}>
                <header>
                  {#if group.name}
                    <input aria-label="分组名称" value={group.name} on:change={(event) => renameShortcutGroup(group.name, event.currentTarget.value)} />
                    <button type="button" on:click={() => deleteShortcutGroup(group.name)}>删除组</button>
                  {:else}
                    <strong>默认</strong>
                  {/if}
                  <span>{group.shortcuts.length}</span>
                </header>
                <div class="shortcut-editor-list">
                  {#each group.shortcuts as shortcut (shortcut.id)}
                    <div draggable="true" role="listitem" on:dragstart={() => (managedDraggedShortcutId = shortcut.id)}>
                      <span>{shortcut.name}</span>
                      <button on:click={() => openShortcutDialog(shortcut)}>编辑</button>
                      <button on:click={() => deleteShortcut(shortcut)}>删除</button>
                    </div>
                  {/each}
                </div>
              </section>
            {/each}
          </div>
        </details>
      </div>

      <div class="panel-section">
        <h3>布局</h3>
        <div class="button-row">
          <button on:click={() => applyLayoutPreset("minimal")}>极简</button>
          <button on:click={() => applyLayoutPreset("balanced")}>平衡</button>
          <button on:click={() => applyLayoutPreset("quick")}>快捷入口</button>
        </div>
        <label>
          搜索框位置
          <select bind:value={settings.layout.searchPosition} on:change={() => persist()}>
            <option value="upper">上方</option>
            <option value="center">居中</option>
            <option value="lower">下方</option>
          </select>
        </label>
        <label class="inline"><input type="checkbox" bind:checked={settings.layout.showShortcuts} on:change={() => persist()} /> 显示快捷方式</label>
        <label>
          网格密度
          <select bind:value={settings.layout.shortcutDensity} on:change={() => persist()}>
            <option value="comfortable">舒适</option>
            <option value="compact">紧凑</option>
            <option value="dense">密集</option>
          </select>
        </label>
        <label>
          快捷方式显示
          <select bind:value={settings.layout.shortcutVisibility} on:change={() => persist()}>
            <option value="always">常亮</option>
            <option value="hover">悬停显示</option>
            <option value="hidden">隐藏</option>
          </select>
        </label>
      </div>

      <div class="panel-section">
        <h3>主题</h3>
        <label>
          模式
          <select bind:value={settings.theme.mode} on:change={() => persist()}>
            <option value="auto">跟随系统</option>
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </label>
        <label>强调色 <input type="color" bind:value={settings.theme.accentColor} on:change={() => persist()} /></label>
        <label>图标透明度 <input type="range" min="0.35" max="1" step="0.01" bind:value={settings.theme.iconOpacity} on:change={() => persist()} /></label>
        <label>面板透明度 <input type="range" min="0.45" max="0.95" step="0.01" bind:value={settings.theme.panelTransparency} on:change={() => persist()} /></label>
      </div>

      <div class="panel-section">
        <h3>键盘</h3>
        <label class="inline"><input type="checkbox" bind:checked={settings.keyboard.focusSearch} on:change={() => persist()} /> 使用 / 或 Ctrl+K 聚焦搜索</label>
        <label class="inline"><input type="checkbox" bind:checked={settings.keyboard.numberShortcuts} on:change={() => persist()} /> 使用数字键打开快捷方式</label>
      </div>

      <div class="panel-section">
        <h3>数据</h3>
        <div class="button-row">
          <button on:click={exportSettings}>导出设置</button>
          <label class="file-button">
            导入设置
            <input accept="application/json" type="file" on:change={importSettings} />
          </label>
        </div>
      </div>
    </aside>
  {/if}

  {#if editingWallpaperCurrent}
    <div class="dialog-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) editingWallpaper = undefined; }}>
      <form class="dialog wallpaper-options-dialog">
        <header>
          <div>
            <h2>单张壁纸设置</h2>
            <p>{editingWallpaperCurrent.name}</p>
          </div>
          <button type="button" aria-label="关闭" on:click={() => (editingWallpaper = undefined)}>关闭</button>
        </header>
        <div class="wallpaper-options-preview">
          {#if editingWallpaperCurrent.thumbDataUrl}<img alt="" src={editingWallpaperCurrent.thumbDataUrl} />{/if}
          <span>{editingWallpaperCurrent.id === settings.wallpaper.activeId ? "当前使用中" : "单独覆盖全局壁纸效果"}</span>
        </div>
        <label>
          填充方式
          <select value={editingWallpaperCurrent.fit ?? ""} on:change={(event) => updateWallpaperOverrides(editingWallpaperCurrent, { fit: event.currentTarget.value ? event.currentTarget.value as WallpaperItem["fit"] : undefined })}>
            <option value="">使用全局默认</option>
            <option value="ambient">完整显示 + 主色背景</option>
            <option value="cover">裁切铺满</option>
            <option value="contain">完整显示</option>
            <option value="fill">拉伸填满</option>
            <option value="blur">模糊填充</option>
          </select>
        </label>
        <label>
          居中方式
          <select value={editingWallpaperCurrent.position ?? ""} on:change={(event) => updateWallpaperOverrides(editingWallpaperCurrent, { position: event.currentTarget.value ? event.currentTarget.value as WallpaperItem["position"] : undefined })}>
            <option value="">使用全局默认</option>
            <option value="center">居中</option>
            <option value="top">顶部</option>
            <option value="bottom">底部</option>
            <option value="left">左侧</option>
            <option value="right">右侧</option>
          </select>
        </label>
        <label>
          叠层
          <select value={editingWallpaperCurrent.overlay ?? ""} on:change={(event) => updateWallpaperOverrides(editingWallpaperCurrent, { overlay: event.currentTarget.value ? event.currentTarget.value as WallpaperItem["overlay"] : undefined })}>
            <option value="">使用全局默认</option>
            <option value="soft">柔和</option>
            <option value="vignette">暗角</option>
            <option value="none">无</option>
          </select>
        </label>
        <div class="wallpaper-option-range">
          <label>模糊 <input disabled={editingWallpaperCurrent.blur === undefined} min="0" max="24" step="1" type="range" value={editingWallpaperCurrent.blur ?? settings.wallpaper.blur} on:change={(event) => updateWallpaperOverrides(editingWallpaperCurrent, { blur: Number(event.currentTarget.value) })} /></label>
          <label class="inline"><input checked={editingWallpaperCurrent.blur === undefined} type="checkbox" on:change={(event) => updateWallpaperOverrides(editingWallpaperCurrent, { blur: event.currentTarget.checked ? undefined : settings.wallpaper.blur })} /> 使用全局</label>
        </div>
        <div class="wallpaper-option-range">
          <label>变暗 <input disabled={editingWallpaperCurrent.dim === undefined} min="0" max="0.75" step="0.01" type="range" value={editingWallpaperCurrent.dim ?? settings.wallpaper.dim} on:change={(event) => updateWallpaperOverrides(editingWallpaperCurrent, { dim: Number(event.currentTarget.value) })} /></label>
          <label class="inline"><input checked={editingWallpaperCurrent.dim === undefined} type="checkbox" on:change={(event) => updateWallpaperOverrides(editingWallpaperCurrent, { dim: event.currentTarget.checked ? undefined : settings.wallpaper.dim })} /> 使用全局</label>
        </div>
        <div class="wallpaper-option-range">
          <label>亮度 <input disabled={editingWallpaperCurrent.brightness === undefined} min="0.55" max="1.25" step="0.01" type="range" value={editingWallpaperCurrent.brightness ?? settings.wallpaper.brightness} on:change={(event) => updateWallpaperOverrides(editingWallpaperCurrent, { brightness: Number(event.currentTarget.value) })} /></label>
          <label class="inline"><input checked={editingWallpaperCurrent.brightness === undefined} type="checkbox" on:change={(event) => updateWallpaperOverrides(editingWallpaperCurrent, { brightness: event.currentTarget.checked ? undefined : settings.wallpaper.brightness })} /> 使用全局</label>
        </div>
        <div class="button-row">
          <button class="small-danger" type="button" on:click={() => resetWallpaperOverrides(editingWallpaperCurrent)}>重置单张设置</button>
          <button type="button" on:click={() => (editingWallpaper = undefined)}>完成</button>
        </div>
      </form>
    </div>
  {/if}

  {#if shortcutDialogOpen}
    <div class="dialog-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) shortcutDialogOpen = false; }}>
      <form class="dialog" on:submit|preventDefault={saveShortcut}>
        <h2>{editingShortcut ? "编辑快捷方式" : "添加快捷方式"}</h2>
        <label>名称 <input bind:value={shortcutDraft.name} required /></label>
        <label>网址 <input bind:value={shortcutDraft.url} required /></label>
        <label>图标 URL <input bind:value={shortcutDraft.icon} placeholder="留空则使用网站图标" /></label>
        <label>分组 <input bind:value={shortcutDraft.group} /></label>
        <div class="button-row">
          <button type="submit">保存</button>
          <button type="button" on:click={() => (shortcutDialogOpen = false)}>取消</button>
        </div>
      </form>
    </div>
  {/if}
</main>
