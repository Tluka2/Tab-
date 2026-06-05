const SETTINGS_KEY = "tab.settings";
const BOOT_PREVIEW_KEY = "tab.bootWallpaperPreview";
const DB_NAME = "tab-wallpapers";
const DB_VERSION = 1;
const WALLPAPER_STORE = "wallpapers";
const BLOB_STORE = "blobs";

const searchEngines = [
  ["google", "Google", "https://www.google.com/search?q={query}"],
  ["bing", "Bing", "https://www.bing.com/search?q={query}"],
  ["baidu", "Baidu", "https://www.baidu.com/s?wd={query}"],
  ["duckduckgo", "DuckDuckGo", "https://duckduckgo.com/?q={query}"],
  ["github", "GitHub", "https://github.com/search?q={query}"],
  ["youtube", "YouTube", "https://www.youtube.com/results?search_query={query}"],
  ["bilibili", "Bilibili", "https://search.bilibili.com/all?keyword={query}"],
  ["custom", "自定义", "{query}"]
].map(([id, name, template]) => ({ id, name, template }));

const defaultSettings = {
  version: 1,
  theme: {
    mode: "auto",
    accentColor: "#70e1c8",
    iconOpacity: 0.9,
    panelTransparency: 0.72
  },
  wallpaper: {
    source: "bing",
    activeId: undefined,
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

let settings = structuredClone(defaultSettings);
let wallpapers = [];
let activeWallpaperUrl = "";
let draggedShortcutId = "";
let statusMessage = "";
let dbPromise;

const app = document.getElementById("app");
const wallpaperEl = document.getElementById("wallpaper");
const wallpaperBlurFillEl = document.getElementById("wallpaperBlurFill");
const workspace = document.getElementById("workspace");
const searchForm = document.getElementById("searchForm");
const searchSuggestions = document.getElementById("searchSuggestions");
const searchInput = document.getElementById("searchInput");
const shortcutsEl = document.getElementById("shortcuts");
const wallpaperAttribution = document.getElementById("wallpaperAttribution");
const settingsButton = document.getElementById("settingsButton");
const settingsPanel = document.getElementById("settingsPanel");
const dialogHost = document.getElementById("dialogHost");

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function asString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value, fallback, min, max) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function asEnum(value, fallback, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function normalizeSearchEngineId(value) {
  const id = asString(value, defaultSettings.search.engineId);
  return searchEngines.some((engine) => engine.id === id) ? id : defaultSettings.search.engineId;
}

function normalizeSearchTemplate(value) {
  const template = asString(value, defaultSettings.search.customTemplate).trim();
  return template.includes("{query}") ? template : defaultSettings.search.customTemplate;
}

function normalizeShortcuts(value) {
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
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index }));
}

function normalizeSettings(value) {
  const source = isRecord(value) ? value : {};
  const theme = isRecord(source.theme) ? source.theme : {};
  const wallpaper = isRecord(source.wallpaper) ? source.wallpaper : {};
  const search = isRecord(source.search) ? source.search : {};
  const layout = isRecord(source.layout) ? source.layout : {};
  const keyboard = isRecord(source.keyboard) ? source.keyboard : {};

  return {
    ...defaultSettings,
    version: 1,
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
      shortcutDensity: asEnum(layout.shortcutDensity, defaultSettings.layout.shortcutDensity, ["comfortable", "compact", "dense"]),
      shortcutVisibility: asEnum(layout.shortcutVisibility, defaultSettings.layout.shortcutVisibility, ["always", "hover", "hidden"])
    },
    keyboard: {
      focusSearch: asBoolean(keyboard.focusSearch, defaultSettings.keyboard.focusSearch),
      numberShortcuts: asBoolean(keyboard.numberShortcuts, defaultSettings.keyboard.numberShortcuts)
    }
  };
}

async function loadSettings() {
  if (globalThis.chrome?.storage?.local) {
    const result = await globalThis.chrome.storage.local.get(SETTINGS_KEY);
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

async function saveSettings(next = settings) {
  settings = normalizeSettings(next);
  if (globalThis.chrome?.storage?.local) {
    await globalThis.chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  } else {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
  render();
}

function exportSettings() {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "Tab",
    settings
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `tab-settings-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importSettingsFile(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const imported = parsed.settings ?? parsed;
    await saveSettings(imported);
    wallpapers = await listWallpapers();
    await resolveActiveWallpaper();
    statusMessage = "设置已导入。";
  } catch {
    statusMessage = "无法导入设置 JSON。";
  }
  renderPanel();
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WALLPAPER_STORE)) db.createObjectStore(WALLPAPER_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE, { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  return dbPromise;
}

async function storeRequest(storeName, mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = run(transaction.objectStore(storeName));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function listWallpapers() {
  const items = await storeRequest(WALLPAPER_STORE, "readonly", (store) => store.getAll());
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

async function saveWallpaper(item, blob) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([WALLPAPER_STORE, BLOB_STORE], "readwrite");
    transaction.objectStore(WALLPAPER_STORE).put(item);
    transaction.objectStore(BLOB_STORE).put({ id: item.blobId, blob });
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}

async function updateWallpaper(item) {
  await storeRequest(WALLPAPER_STORE, "readwrite", (store) => store.put(item));
}

async function deleteWallpaper(item) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([WALLPAPER_STORE, BLOB_STORE], "readwrite");
    transaction.objectStore(WALLPAPER_STORE).delete(item.id);
    transaction.objectStore(BLOB_STORE).delete(item.blobId);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}

async function getWallpaperBlob(blobId) {
  const stored = await storeRequest(BLOB_STORE, "readonly", (store) => store.get(blobId));
  return stored?.blob;
}

async function makeThumbnail(blob, maxSize = 48, quality = 0.72) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

function storeBootPreview(dataUrl) {
  if (!dataUrl) return;
  try {
    localStorage.setItem(BOOT_PREVIEW_KEY, dataUrl);
  } catch {}
}

async function importLocalWallpaper(file) {
  const blob = file.slice(0, file.size, file.type || "image/jpeg");
  const id = crypto.randomUUID();
  const thumbDataUrl = await makeThumbnail(blob);
  const item = {
    id,
    name: file.name.replace(/\.[^.]+$/, "") || "本地壁纸",
    source: "local",
    blobId: `blob-${id}`,
    thumbDataUrl,
    createdAt: Date.now()
  };
  await saveWallpaper(item, blob);
  storeBootPreview(thumbDataUrl);
  return item;
}

async function fetchBingDailyWallpaper() {
  const response = await fetch("https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US");
  if (!response.ok) throw new Error(`Bing 壁纸请求失败：${response.status}`);
  const data = await response.json();
  const image = data.images?.[0];
  if (!image) throw new Error("Bing 没有返回图片");
  const url = new URL(image.url, "https://www.bing.com");
  url.searchParams.set("rf", "LaDigue_1920x1080.jpg");
  const imageResponse = await fetch(url.toString());
  if (!imageResponse.ok) throw new Error(`Bing 图片请求失败：${imageResponse.status}`);
  const blob = await imageResponse.blob();
  const thumbDataUrl = await makeThumbnail(blob);
  const id = `bing-${image.hsh ?? new Date().toISOString().slice(0, 10)}`;
  const item = {
    id,
    name: image.title || "Bing 每日壁纸",
    source: "bing",
    blobId: `blob-${id}`,
    thumbDataUrl,
    createdAt: Date.now(),
    attribution: image.copyright
  };
  await saveWallpaper(item, blob);
  storeBootPreview(thumbDataUrl);
  return item;
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z]+:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function faviconFor(url) {
  try {
    const parsed = new URL(normalizeUrl(url));
    return `${parsed.origin}/favicon.ico`;
  } catch {
    return "";
  }
}

function getSortedShortcuts() {
  return [...settings.shortcuts].sort((a, b) => a.order - b.order);
}

function navigateSearch(value) {
  const query = value.trim();
  if (!query) return;
  const activeEngine = searchEngines.find((engine) => engine.id === settings.search.engineId) ?? searchEngines[0];
  const template = settings.search.engineId === "custom" ? settings.search.customTemplate : activeEngine.template;
  const looksLikeUrl = /^([a-z]+:\/\/)?([\w-]+\.)+[\w-]{2,}(\/.*)?$/i.test(query);
  window.location.href = looksLikeUrl ? normalizeUrl(query) : template.replace("{query}", encodeURIComponent(query));
}

let activeSuggestionIndex = -1;

function renderSearchSuggestions(query) {
  if (!searchSuggestions) return;
  searchSuggestions.replaceChildren();
  activeSuggestionIndex = -1;
  if (!query) {
    searchSuggestions.classList.add("hidden");
    return;
  }
  const lower = query.toLowerCase();
  const matches = getSortedShortcuts().filter((s) =>
    s.name.toLowerCase().includes(lower) || s.url.toLowerCase().includes(lower)
  );
  if (matches.length === 0) {
    searchSuggestions.classList.add("hidden");
    return;
  }
  matches.forEach((shortcut, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.index = String(index);
    if (shortcut.icon) {
      const img = document.createElement("img");
      img.src = shortcut.icon;
      img.alt = "";
      img.onerror = () => { img.remove(); };
      button.append(img);
    }
    const nameSpan = document.createElement("span");
    nameSpan.textContent = shortcut.name;
    button.append(nameSpan);
    const urlSpan = document.createElement("span");
    urlSpan.className = "suggestion-url";
    urlSpan.textContent = shortcut.url;
    button.append(urlSpan);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      window.location.href = shortcut.url;
    });
    searchSuggestions.append(button);
  });
  searchSuggestions.classList.remove("hidden");
}

function updateSuggestionHighlight() {
  if (!searchSuggestions) return;
  const buttons = searchSuggestions.querySelectorAll("button");
  buttons.forEach((b) => b.classList.remove("active"));
  if (activeSuggestionIndex >= 0 && activeSuggestionIndex < buttons.length) {
    buttons[activeSuggestionIndex].classList.add("active");
    buttons[activeSuggestionIndex].scrollIntoView({ block: "nearest" });
  }
}

function hideSearchSuggestions() {
  if (searchSuggestions) searchSuggestions.classList.add("hidden");
  activeSuggestionIndex = -1;
}

async function resolveActiveWallpaper() {
  if (settings.wallpaper.source === "rotation") {
    const rotationItems = settings.wallpaper.rotationIds
      .map((id) => wallpapers.find((item) => item.id === id))
      .filter(Boolean);
    if (rotationItems.length > 0) {
      const activeIndex = rotationItems.findIndex((item) => item.id === settings.wallpaper.activeId);
      await setActiveWallpaper(rotationItems[(activeIndex + 1) % rotationItems.length], true);
      return;
    }
  }

  const preferred =
    wallpapers.find((item) => item.id === settings.wallpaper.activeId) ??
    wallpapers.find((item) => settings.wallpaper.source !== "rotation" && item.source === settings.wallpaper.source) ??
    wallpapers[0];
  if (preferred) {
    await setActiveWallpaper(preferred, preferred.id !== settings.wallpaper.activeId);
  } else if (settings.wallpaper.source === "bing") {
    await refreshBingWallpaper();
  }
}

async function setActiveWallpaper(item, shouldPersist = true) {
  const blob = await getWallpaperBlob(item.blobId);
  if (!blob) return;
  if (activeWallpaperUrl.startsWith("blob:")) URL.revokeObjectURL(activeWallpaperUrl);
  activeWallpaperUrl = URL.createObjectURL(blob);
  item.lastUsedAt = Date.now();
  await updateWallpaper(item);
  storeBootPreview(item.thumbDataUrl);
  if (shouldPersist) {
    await saveSettings({ ...settings, wallpaper: { ...settings.wallpaper, activeId: item.id } });
  } else {
    settings = normalizeSettings({ ...settings, wallpaper: { ...settings.wallpaper, activeId: item.id } });
    render();
  }
}

async function refreshBingWallpaper() {
  statusMessage = "正在获取 Bing 壁纸...";
  renderPanel();
  try {
    const item = await fetchBingDailyWallpaper();
    wallpapers = await listWallpapers();
    await saveSettings({
      ...settings,
      wallpaper: {
        ...settings.wallpaper,
        source: "bing",
        activeId: item.id,
        rotationIds: Array.from(new Set([...settings.wallpaper.rotationIds, item.id]))
      }
    });
    await setActiveWallpaper(item, false);
    statusMessage = "Bing 壁纸已缓存。";
  } catch (error) {
    statusMessage = error instanceof Error ? error.message : "无法获取 Bing 壁纸。";
  }
  renderPanel();
}

async function handleLocalWallpaper(file) {
  statusMessage = "正在导入壁纸...";
  renderPanel();
  const item = await importLocalWallpaper(file);
  wallpapers = await listWallpapers();
  await saveSettings({
    ...settings,
    wallpaper: {
      ...settings.wallpaper,
      source: "local",
      activeId: item.id,
      rotationIds: Array.from(new Set([...settings.wallpaper.rotationIds, item.id]))
    }
  });
  await setActiveWallpaper(item, false);
  statusMessage = "本地壁纸已缓存。";
  renderPanel();
}

async function removeWallpaper(item) {
  await deleteWallpaper(item);
  wallpapers = await listWallpapers();
  const nextActive = wallpapers[0];
  await saveSettings({
    ...settings,
    wallpaper: {
      ...settings.wallpaper,
      activeId: nextActive?.id,
      rotationIds: settings.wallpaper.rotationIds.filter((id) => id !== item.id)
    }
  });
  if (nextActive) await setActiveWallpaper(nextActive, false);
  else activeWallpaperUrl = "";
  render();
}

async function useWallpaperSource(source) {
  await saveSettings({ ...settings, wallpaper: { ...settings.wallpaper, source } });
  await resolveActiveWallpaper();
}

async function showNextRotationWallpaper() {
  const rotationItems = settings.wallpaper.rotationIds
    .map((id) => wallpapers.find((item) => item.id === id))
    .filter(Boolean);
  if (rotationItems.length === 0) return;
  const activeIndex = rotationItems.findIndex((item) => item.id === settings.wallpaper.activeId);
  await saveSettings({ ...settings, wallpaper: { ...settings.wallpaper, source: "rotation" } });
  await setActiveWallpaper(rotationItems[(activeIndex + 1) % rotationItems.length]);
}

async function toggleWallpaperRotation(item, enabled) {
  const rotationIds = enabled
    ? Array.from(new Set([...settings.wallpaper.rotationIds, item.id]))
    : settings.wallpaper.rotationIds.filter((id) => id !== item.id);
  await saveSettings({ ...settings, wallpaper: { ...settings.wallpaper, rotationIds } });
}

async function saveShortcut(draft, editingId) {
  const url = normalizeUrl(draft.url);
  if (!draft.name.trim() || !url) return;
  const shortcuts = editingId
    ? settings.shortcuts.map((item) =>
        item.id === editingId
          ? {
              ...item,
              name: draft.name.trim(),
              url,
              group: draft.group.trim() || undefined,
              icon: draft.icon.trim() || faviconFor(url)
            }
          : item
      )
    : [
        ...settings.shortcuts,
        {
          id: crypto.randomUUID(),
          name: draft.name.trim(),
          url,
          group: draft.group.trim() || undefined,
          icon: draft.icon.trim() || faviconFor(url),
          order: settings.shortcuts.length
        }
      ];
  await saveSettings({ ...settings, shortcuts });
  closeDialog();
}

async function deleteShortcut(id) {
  await saveSettings({
    ...settings,
    shortcuts: settings.shortcuts
      .filter((item) => item.id !== id)
      .map((item, index) => ({ ...item, order: index }))
  });
}

async function reorderShortcut(targetId) {
  if (!draggedShortcutId || draggedShortcutId === targetId) return;
  const next = getSortedShortcuts();
  const from = next.findIndex((item) => item.id === draggedShortcutId);
  const to = next.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0) return;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  await saveSettings({ ...settings, shortcuts: next.map((item, index) => ({ ...item, order: index })) });
}

async function clearShortcutIcon(id) {
  await saveSettings({
    ...settings,
    shortcuts: settings.shortcuts.map((item) => (item.id === id ? { ...item, icon: undefined } : item))
  });
}

function render() {
  app.classList.toggle("theme-light", settings.theme.mode === "light");
  app.classList.toggle("theme-dark", settings.theme.mode === "dark");
  app.style.setProperty("--wallpaper-url", activeWallpaperUrl ? `url("${activeWallpaperUrl}")` : "var(--boot-wallpaper)");
  app.style.setProperty("--wallpaper-blur", `${settings.wallpaper.blur}px`);
  app.style.setProperty("--wallpaper-dim", String(settings.wallpaper.dim));
  app.style.setProperty("--wallpaper-brightness", String(settings.wallpaper.brightness));
  app.style.setProperty("--accent", settings.theme.accentColor);
  app.style.setProperty("--icon-opacity", String(settings.theme.iconOpacity));
  app.style.setProperty("--panel-alpha", String(settings.theme.panelTransparency));

  wallpaperEl.classList.toggle("overlay-soft", settings.wallpaper.overlay === "soft");
  wallpaperEl.classList.toggle("overlay-vignette", settings.wallpaper.overlay === "vignette");
  wallpaperEl.classList.toggle("fit-cover", settings.wallpaper.fit === "cover");
  wallpaperEl.classList.toggle("fit-contain", settings.wallpaper.fit === "contain");
  wallpaperEl.classList.toggle("fit-fill", settings.wallpaper.fit === "fill");
  wallpaperEl.classList.toggle("fit-blur", settings.wallpaper.fit === "blur");
  if (wallpaperBlurFillEl) wallpaperBlurFillEl.classList.toggle("visible", settings.wallpaper.fit === "blur");

  workspace.className = `workspace pos-${settings.layout.searchPosition}`;
  searchForm.className = `search-shell ${settings.search.style === "glass" ? "" : settings.search.style} ${settings.search.visibility === "always" ? "" : `visibility-${settings.search.visibility}`}`;
  searchInput.placeholder = settings.search.placeholder;
  shortcutsEl.hidden = !settings.layout.showShortcuts;
  shortcutsEl.className = `shortcuts ${settings.layout.shortcutDensity === "comfortable" ? "" : `density-${settings.layout.shortcutDensity}`} ${settings.layout.shortcutVisibility === "always" ? "" : `visibility-${settings.layout.shortcutVisibility}`}`;
  const activeWallpaper = wallpapers.find((item) => item.id === settings.wallpaper.activeId);
  wallpaperAttribution.textContent = activeWallpaper?.attribution ?? "";
  wallpaperAttribution.classList.toggle("hidden", !activeWallpaper?.attribution);
  renderShortcuts();
  renderPanel();
}

function renderShortcuts() {
  shortcutsEl.replaceChildren();
  getSortedShortcuts().forEach((shortcut, index) => {
    const anchor = document.createElement("a");
    anchor.className = "shortcut";
    anchor.href = shortcut.url;
    anchor.draggable = true;
    anchor.addEventListener("dragstart", () => {
      draggedShortcutId = shortcut.id;
    });
    anchor.addEventListener("dragover", (event) => event.preventDefault());
    anchor.addEventListener("drop", (event) => {
      event.preventDefault();
      void reorderShortcut(shortcut.id);
    });

    const number = document.createElement("span");
    number.className = "shortcut-index";
    number.textContent = String(index + 1);
    anchor.append(number);

    if (shortcut.icon) {
      const image = document.createElement("img");
      image.alt = "";
      image.src = shortcut.icon;
      image.addEventListener("error", () => {
        void clearShortcutIcon(shortcut.id);
      });
      anchor.append(image);
    } else {
      const icon = document.createElement("span");
      icon.className = "fallback-icon";
      icon.textContent = shortcut.name.slice(0, 1).toUpperCase();
      anchor.append(icon);
    }

    const label = document.createElement("span");
    label.className = "shortcut-label";
    label.textContent = shortcut.name;
    anchor.append(label);
    shortcutsEl.append(anchor);
  });
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderPanel() {
  if (settingsPanel.classList.contains("hidden")) return;
  settingsPanel.innerHTML = `
    <header>
      <h2>设置</h2>
      <button id="closeSettings" type="button">关闭</button>
    </header>
    <div class="panel-section">
      <h3>壁纸</h3>
      <div class="button-row">
        <button id="bingButton" type="button">Bing 每日壁纸</button>
        <label class="file-button">上传 <input id="wallpaperUpload" accept="image/*" type="file" /></label>
        <button id="nextWallpaper" type="button">下一张</button>
      </div>
      <label>来源
        <select id="wallpaperSource">
          <option value="bing">Bing 每日壁纸</option>
          <option value="local">本地</option>
          <option value="rotation">轮换</option>
        </select>
      </label>
      ${statusMessage ? `<p class="status">${htmlEscape(statusMessage)}</p>` : ""}
      <div id="wallpaperList" class="wallpaper-list"></div>
      <label>模糊 <input id="wallpaperBlur" type="range" min="0" max="24" /></label>
      <label>变暗 <input id="wallpaperDim" type="range" min="0" max="0.75" step="0.01" /></label>
      <label>亮度 <input id="wallpaperBrightness" type="range" min="0.55" max="1.25" step="0.01" /></label>
      <label>遮罩
        <select id="wallpaperOverlay">
          <option value="soft">柔和</option>
          <option value="vignette">暗角</option>
          <option value="none">无</option>
        </select>
      </label>
      <label>铺满方式
        <select id="wallpaperFit">
          <option value="cover">裁切铺满</option>
          <option value="contain">完整显示</option>
          <option value="fill">拉伸填满</option>
          <option value="blur">模糊填充</option>
        </select>
      </label>
    </div>
    <div class="panel-section">
      <h3>搜索</h3>
      <label>搜索引擎 <select id="searchEngine"></select></label>
      <label id="customTemplateWrap">模板 <input id="customTemplate" /></label>
      <label>占位文本 <input id="searchPlaceholder" /></label>
      <label>样式
        <select id="searchStyle">
          <option value="glass">玻璃</option>
          <option value="solid">实色</option>
          <option value="line">线条</option>
        </select>
      </label>
      <label>显示
        <select id="searchVisibility">
          <option value="always">常亮</option>
          <option value="hover">悬停显示</option>
          <option value="hidden">隐藏</option>
        </select>
      </label>
    </div>
    <div class="panel-section">
      <h3>快捷方式</h3>
      <button id="addShortcut" type="button">添加快捷方式</button>
      <div id="shortcutEditorList" class="shortcut-editor-list"></div>
    </div>
    <div class="panel-section">
      <h3>布局</h3>
      <label>搜索框位置
        <select id="searchPosition">
          <option value="upper">上方</option>
          <option value="center">居中</option>
          <option value="lower">下方</option>
        </select>
      </label>
      <label class="inline"><input id="showShortcuts" type="checkbox" /> 显示快捷方式</label>
      <label>网格密度
        <select id="shortcutDensity">
          <option value="comfortable">舒适</option>
          <option value="compact">紧凑</option>
          <option value="dense">密集</option>
        </select>
      </label>
      <label>快捷方式显示
        <select id="shortcutVisibility">
          <option value="always">常亮</option>
          <option value="hover">悬停显示</option>
          <option value="hidden">隐藏</option>
        </select>
      </label>
    </div>
    <div class="panel-section">
      <h3>主题</h3>
      <label>模式
        <select id="themeMode">
          <option value="auto">跟随系统</option>
          <option value="dark">深色</option>
          <option value="light">浅色</option>
        </select>
      </label>
      <label>强调色 <input id="accentColor" type="color" /></label>
      <label>图标透明度 <input id="iconOpacity" type="range" min="0.35" max="1" step="0.01" /></label>
      <label>面板透明度 <input id="panelTransparency" type="range" min="0.45" max="0.95" step="0.01" /></label>
    </div>
    <div class="panel-section">
      <h3>键盘</h3>
      <label class="inline"><input id="focusSearchShortcut" type="checkbox" /> 使用 / 或 Ctrl+K 聚焦搜索</label>
      <label class="inline"><input id="numberShortcutKeys" type="checkbox" /> 使用数字键打开快捷方式</label>
    </div>
    <div class="panel-section">
      <h3>数据</h3>
      <div class="button-row">
        <button id="exportSettings" type="button">导出设置</button>
        <label class="file-button">导入设置 <input id="importSettings" accept="application/json" type="file" /></label>
      </div>
    </div>
  `;
  bindPanelControls();
}

function bindPanelControls() {
  const $ = (id) => document.getElementById(id);
  $("closeSettings").addEventListener("click", closeSettings);
  $("bingButton").addEventListener("click", () => void refreshBingWallpaper());
  $("nextWallpaper").addEventListener("click", () => void showNextRotationWallpaper());
  $("wallpaperUpload").addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0];
    if (file) void handleLocalWallpaper(file);
  });

  const wallpaperSource = $("wallpaperSource");
  wallpaperSource.value = settings.wallpaper.source;
  wallpaperSource.addEventListener("change", () => void useWallpaperSource(wallpaperSource.value));

  const wallpaperList = $("wallpaperList");
  wallpapers.forEach((item) => {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = `wallpaper-choice ${item.id === settings.wallpaper.activeId ? "active" : ""}`;
    choice.innerHTML = `${item.thumbDataUrl ? `<img alt="" src="${item.thumbDataUrl}" />` : "<span></span>"}<span>${htmlEscape(item.name)}</span>`;
    choice.addEventListener("click", () => void setActiveWallpaper(item));
    const rotateLabel = document.createElement("label");
    rotateLabel.className = "mini-check";
    const rotate = document.createElement("input");
    rotate.type = "checkbox";
    rotate.checked = settings.wallpaper.rotationIds.includes(item.id);
    rotate.addEventListener("change", () => void toggleWallpaperRotation(item, rotate.checked));
    rotateLabel.append(rotate, document.createTextNode("轮换"));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "small-danger";
    remove.textContent = "删除";
    remove.addEventListener("click", () => void removeWallpaper(item));
    wallpaperList.append(choice, rotateLabel, remove);
  });

  bindSetting("wallpaperBlur", settings.wallpaper.blur, (value) => ({ wallpaper: { ...settings.wallpaper, blur: Number(value) } }));
  bindSetting("wallpaperDim", settings.wallpaper.dim, (value) => ({ wallpaper: { ...settings.wallpaper, dim: Number(value) } }));
  bindSetting("wallpaperBrightness", settings.wallpaper.brightness, (value) => ({ wallpaper: { ...settings.wallpaper, brightness: Number(value) } }));
  bindSelect("wallpaperOverlay", settings.wallpaper.overlay, (value) => ({ wallpaper: { ...settings.wallpaper, overlay: value } }));
  bindSelect("wallpaperFit", settings.wallpaper.fit, (value) => ({ wallpaper: { ...settings.wallpaper, fit: value } }));

  const searchEngine = $("searchEngine");
  searchEngines.forEach((engine) => {
    const option = document.createElement("option");
    option.value = engine.id;
    option.textContent = engine.name;
    searchEngine.append(option);
  });
  bindSelect("searchEngine", settings.search.engineId, (value) => ({ search: { ...settings.search, engineId: value } }));
  $("customTemplateWrap").hidden = settings.search.engineId !== "custom";
  bindCustomTemplateSetting();
  bindSetting("searchPlaceholder", settings.search.placeholder, (value) => ({ search: { ...settings.search, placeholder: value } }));
  bindSelect("searchStyle", settings.search.style, (value) => ({ search: { ...settings.search, style: value } }));
  bindSelect("searchVisibility", settings.search.visibility, (value) => ({ search: { ...settings.search, visibility: value } }));

  $("addShortcut").addEventListener("click", () => openShortcutDialog());
  const shortcutEditorList = $("shortcutEditorList");
  getSortedShortcuts().forEach((shortcut) => {
    const row = document.createElement("div");
    row.className = "shortcut-row";
    const label = document.createElement("span");
    label.textContent = shortcut.name;
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "编辑";
    edit.addEventListener("click", () => openShortcutDialog(shortcut));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "删除";
    remove.addEventListener("click", () => void deleteShortcut(shortcut.id));
    row.append(label, edit, remove);
    shortcutEditorList.append(row);
  });

  bindSelect("searchPosition", settings.layout.searchPosition, (value) => ({ layout: { ...settings.layout, searchPosition: value } }));
  const showShortcuts = $("showShortcuts");
  showShortcuts.checked = settings.layout.showShortcuts;
  showShortcuts.addEventListener("change", () => void saveSettings({ ...settings, layout: { ...settings.layout, showShortcuts: showShortcuts.checked } }));
  bindSelect("shortcutDensity", settings.layout.shortcutDensity, (value) => ({ layout: { ...settings.layout, shortcutDensity: value } }));
  bindSelect("shortcutVisibility", settings.layout.shortcutVisibility, (value) => ({ layout: { ...settings.layout, shortcutVisibility: value } }));

  bindSelect("themeMode", settings.theme.mode, (value) => ({ theme: { ...settings.theme, mode: value } }));
  bindSetting("accentColor", settings.theme.accentColor, (value) => ({ theme: { ...settings.theme, accentColor: value } }));
  bindSetting("iconOpacity", settings.theme.iconOpacity, (value) => ({ theme: { ...settings.theme, iconOpacity: Number(value) } }));
  bindSetting("panelTransparency", settings.theme.panelTransparency, (value) => ({ theme: { ...settings.theme, panelTransparency: Number(value) } }));

  const focusSearchShortcut = $("focusSearchShortcut");
  focusSearchShortcut.checked = settings.keyboard.focusSearch;
  focusSearchShortcut.addEventListener("change", () =>
    void saveSettings({ ...settings, keyboard: { ...settings.keyboard, focusSearch: focusSearchShortcut.checked } })
  );
  const numberShortcutKeys = $("numberShortcutKeys");
  numberShortcutKeys.checked = settings.keyboard.numberShortcuts;
  numberShortcutKeys.addEventListener("change", () =>
    void saveSettings({ ...settings, keyboard: { ...settings.keyboard, numberShortcuts: numberShortcutKeys.checked } })
  );

  $("exportSettings").addEventListener("click", exportSettings);
  $("importSettings").addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0];
    if (file) void importSettingsFile(file);
    event.currentTarget.value = "";
  });
}

function bindSetting(id, value, makePatch) {
  const element = document.getElementById(id);
  element.value = value;
  element.addEventListener("change", () => void saveSettings({ ...settings, ...makePatch(element.value) }));
}

function bindCustomTemplateSetting() {
  const element = document.getElementById("customTemplate");
  element.value = settings.search.customTemplate;
  element.addEventListener("change", () => {
    if (!element.value.includes("{query}")) {
      statusMessage = "自定义搜索模板必须包含 {query}，已恢复默认值。";
    }
    void saveSettings({ ...settings, search: { ...settings.search, customTemplate: element.value } });
  });
}

function bindSelect(id, value, makePatch) {
  const element = document.getElementById(id);
  element.value = value;
  element.addEventListener("change", () => void saveSettings({ ...settings, ...makePatch(element.value) }));
}

function openSettings() {
  settingsPanel.classList.remove("hidden");
  renderPanel();
}

function closeSettings() {
  settingsPanel.classList.add("hidden");
}

function openShortcutDialog(shortcut) {
  const editingId = shortcut?.id;
  dialogHost.innerHTML = `
    <div class="dialog-backdrop" role="presentation">
      <form class="dialog">
        <h2>${editingId ? "编辑快捷方式" : "添加快捷方式"}</h2>
        <label>名称 <input id="shortcutName" required value="${htmlEscape(shortcut?.name ?? "")}" /></label>
        <label>网址 <input id="shortcutUrl" required value="${htmlEscape(shortcut?.url ?? "")}" /></label>
        <label>图标 URL <input id="shortcutIcon" value="${htmlEscape(shortcut?.icon ?? "")}" placeholder="留空则使用网站图标" /></label>
        <label>分组 <input id="shortcutGroup" value="${htmlEscape(shortcut?.group ?? "")}" /></label>
        <div class="button-row">
          <button type="submit">保存</button>
          <button id="cancelShortcut" type="button">取消</button>
        </div>
      </form>
    </div>
  `;
  const backdrop = dialogHost.querySelector(".dialog-backdrop");
  const form = dialogHost.querySelector("form");
  backdrop.addEventListener("click", closeDialog);
  form.addEventListener("click", (event) => event.stopPropagation());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveShortcut(
      {
        name: document.getElementById("shortcutName").value,
        url: document.getElementById("shortcutUrl").value,
        icon: document.getElementById("shortcutIcon").value,
        group: document.getElementById("shortcutGroup").value
      },
      editingId
    );
  });
  document.getElementById("cancelShortcut").addEventListener("click", closeDialog);
}

function closeDialog() {
  dialogHost.replaceChildren();
}

function isTypingTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
}

function bindEvents() {
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    hideSearchSuggestions();
    navigateSearch(searchInput.value);
  });
  searchInput.addEventListener("focus", () => {
    searchForm.classList.add("focus-visible");
    renderSearchSuggestions(searchInput.value.trim());
  });
  searchInput.addEventListener("blur", () => {
    setTimeout(hideSearchSuggestions, 120);
    searchForm.classList.remove("focus-visible");
  });
  searchInput.addEventListener("input", () => {
    renderSearchSuggestions(searchInput.value.trim());
  });
  settingsButton.addEventListener("click", openSettings);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (searchSuggestions && !searchSuggestions.classList.contains("hidden")) {
        hideSearchSuggestions();
        return;
      }
      closeSettings();
      closeDialog();
      return;
    }
    if (isTypingTarget(event.target)) {
      if (searchSuggestions && !searchSuggestions.classList.contains("hidden")) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, searchSuggestions.querySelectorAll("button").length - 1);
          updateSuggestionHighlight();
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, 0);
          updateSuggestionHighlight();
          return;
        }
        if (event.key === "Enter") {
          const buttons = searchSuggestions.querySelectorAll("button");
          if (activeSuggestionIndex >= 0 && activeSuggestionIndex < buttons.length) {
            event.preventDefault();
            const url = buttons[activeSuggestionIndex].querySelector(".suggestion-url").textContent;
            window.location.href = url;
            return;
          }
        }
      }
      return;
    }
    if (settings.keyboard.focusSearch && (event.key === "/" || (event.ctrlKey && event.key.toLowerCase() === "k"))) {
      event.preventDefault();
      searchForm.classList.add("focus-visible");
      searchInput.focus();
      return;
    }
    if (settings.keyboard.numberShortcuts && /^[1-9]$/.test(event.key)) {
      const shortcut = getSortedShortcuts()[Number(event.key) - 1];
      if (shortcut) window.location.href = shortcut.url;
    }
  });
}

async function initialize() {
  bindEvents();
  settings = await loadSettings();
  wallpapers = await listWallpapers();
  render();
  await resolveActiveWallpaper();
}

void initialize();
