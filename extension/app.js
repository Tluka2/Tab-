const SETTINGS_KEY = "tab.settings";
const BOOT_PREVIEW_KEY = "tab.bootWallpaperPreview";
const BOOT_SETTINGS_KEY = "tab.bootSettings";
const DB_NAME = "tab-wallpapers";
const DB_VERSION = 1;
const WALLPAPER_STORE = "wallpapers";
const BLOB_STORE = "blobs";
const MAX_IMPORT_WALLPAPERS = 100;
const MAX_IMPORT_WALLPAPER_BYTES = 25 * 1024 * 1024;
const MAX_IMPORT_WALLPAPER_TOTAL_BYTES = 250 * 1024 * 1024;

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
    rotationRecentIds: [],
    rotationNextId: undefined,
    fit: "cover",
    position: "center",
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

function readBootSettings() {
  try {
    const raw = localStorage.getItem(BOOT_SETTINGS_KEY);
    if (!raw) return structuredClone(defaultSettings);
    const bootSettings = JSON.parse(raw);
    return normalizeSettings({
      ...structuredClone(defaultSettings),
      theme: { ...defaultSettings.theme, ...bootSettings.theme },
      wallpaper: { ...defaultSettings.wallpaper, ...bootSettings.wallpaper },
      search: { ...defaultSettings.search, ...bootSettings.search },
      layout: { ...defaultSettings.layout, ...bootSettings.layout },
      keyboard: { ...defaultSettings.keyboard, ...bootSettings.keyboard }
    });
  } catch {
    return structuredClone(defaultSettings);
  }
}

let settings = readBootSettings();
let wallpapers = [];
let wallpaperSummary = { count: 0, bytes: 0, missing: 0 };
let activeWallpaperUrl = "";
let ambientWallpaperBackground = "";
let wallpaperLoading = true;
let preheatedWallpaperId = "";
let preheatedWallpaperUrl = "";
let preheatedWallpaperPromise = Promise.resolve();
let draggedShortcutId = "";
let managedDraggedShortcutId = "";
let statusMessage = "";
let dbPromise;
let wallpaperOverrideQueue = Promise.resolve();
const systemThemeMatcher = window.matchMedia?.("(prefers-color-scheme: light)");

const app = document.getElementById("app");
const wallpaperBackEl = document.getElementById("wallpaperBack");
const wallpaperEl = document.getElementById("wallpaper");
const wallpaperBlurFillEl = document.getElementById("wallpaperBlurFill");
const wallpaperAmbientFillEl = document.getElementById("wallpaperAmbientFill");
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

function getResolvedTheme() {
  if (settings.theme.mode === "light" || settings.theme.mode === "dark") return settings.theme.mode;
  return systemThemeMatcher?.matches ? "light" : "dark";
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
      rotationRecentIds: asStringArray(wallpaper.rotationRecentIds),
      rotationNextId: typeof wallpaper.rotationNextId === "string" ? wallpaper.rotationNextId : undefined,
      fit: asEnum(wallpaper.fit, defaultSettings.wallpaper.fit, ["cover", "contain", "fill", "blur", "ambient"]),
      position: asEnum(wallpaper.position, defaultSettings.wallpaper.position, ["center", "top", "bottom", "left", "right"]),
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
  let next;
  if (globalThis.chrome?.storage?.local) {
    const result = await globalThis.chrome.storage.local.get(SETTINGS_KEY);
    next = normalizeSettings(result[SETTINGS_KEY]);
  } else {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) next = normalizeSettings(undefined);
    else {
      try {
        next = normalizeSettings(JSON.parse(raw));
      } catch {
        next = normalizeSettings(undefined);
      }
    }
  }
  storeBootSettings(next);
  return next;
}

async function saveSettings(next = settings) {
  settings = normalizeSettings(next);
  storeBootSettings(settings);
  if (globalThis.chrome?.storage?.local) {
    await globalThis.chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  } else {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
  render();
}

function storeBootSettings(next) {
  try {
    localStorage.setItem(
      BOOT_SETTINGS_KEY,
      JSON.stringify({
        theme: next.theme,
        wallpaper: {
          fit: next.wallpaper.fit,
          position: next.wallpaper.position,
          blur: next.wallpaper.blur,
          dim: next.wallpaper.dim,
          brightness: next.wallpaper.brightness,
          overlay: next.wallpaper.overlay
        },
        search: {
          style: next.search.style,
          visibility: next.search.visibility
        },
        layout: next.layout
      })
    );
  } catch {}
}

async function exportSettings() {
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

async function importSettingsFile(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const imported = isRecord(parsed) && parsed.settings ? parsed.settings : parsed;
    if (Array.isArray(parsed.wallpapers)) {
      let importedWallpaperCount = 0;
      let importedWallpaperBytes = 0;
      for (const entry of parsed.wallpapers.slice(0, MAX_IMPORT_WALLPAPERS)) {
        if (!isRecord(entry) || !isRecord(entry.item) || typeof entry.dataUrl !== "string") continue;
        try {
          const blob = await dataUrlToImageBlob(entry.dataUrl);
          if (blob.size > MAX_IMPORT_WALLPAPER_BYTES) continue;
          if (importedWallpaperBytes + blob.size > MAX_IMPORT_WALLPAPER_TOTAL_BYTES) break;
          const item = normalizeImportedWallpaperItem(entry.item, blob);
          await saveWallpaper(item, blob);
          importedWallpaperCount += 1;
          importedWallpaperBytes += blob.size;
        } catch {}
      }
    }
    await saveSettings(imported);
    wallpapers = await listWallpapers();
    await refreshWallpaperSummary();
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

async function getWallpaperStorageSummary() {
  let bytes = 0;
  let missing = 0;
  for (const item of wallpapers) {
    const blob = await getWallpaperBlob(item.blobId);
    if (blob) bytes += blob.size;
    else missing += 1;
  }
  return { count: wallpapers.length, bytes, missing };
}

async function refreshWallpaperSummary() {
  wallpaperSummary = await getWallpaperStorageSummary();
}

async function backfillWallpaperPreviews(limit = 3) {
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

window.backfillWallpaperPreviews = backfillWallpaperPreviews;

function runWhenIdle(task) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(task, { timeout: 1500 });
    return;
  }
  window.setTimeout(task, 120);
}

async function deleteBrokenWallpapers() {
  let deleted = 0;
  for (const item of await listWallpapers()) {
    const blob = await getWallpaperBlob(item.blobId);
    if (!blob) {
      await deleteWallpaper(item);
      deleted += 1;
    }
  }
  return deleted;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

async function hashBlob(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(0, comma);
  const mime = header.match(/data:(.*?);/)?.[1] ?? "image/png";
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function dataUrlToImageBlob(dataUrl) {
  const blob = dataUrlToBlob(dataUrl);
  if (!blob.type.startsWith("image/")) throw new Error("Imported wallpaper is not an image");
  return blob;
}

function normalizeImportedWallpaperItem(item, blob) {
  const id = asString(item.id, crypto.randomUUID());
  const source = item.source === "bing" ? "bing" : "local";
  return {
    id,
    name: asString(item.name, source === "bing" ? "Bing 每日壁纸" : "本地壁纸").slice(0, 120),
    source,
    blobId: asString(item.blobId, `blob-${id}`),
    thumbDataUrl: typeof item.thumbDataUrl === "string" && item.thumbDataUrl.startsWith("data:image/") ? item.thumbDataUrl : undefined,
    previewDataUrl:
      typeof item.previewDataUrl === "string" && item.previewDataUrl.startsWith("data:image/") ? item.previewDataUrl : undefined,
    createdAt: asNumber(item.createdAt, Date.now(), 0, Date.now()),
    lastUsedAt: typeof item.lastUsedAt === "number" ? item.lastUsedAt : undefined,
    attribution: typeof item.attribution === "string" ? item.attribution.slice(0, 500) : undefined,
    contentHash: typeof item.contentHash === "string" ? item.contentHash.slice(0, 128) : undefined,
    fit: asEnum(item.fit, undefined, ["cover", "contain", "fill", "blur", "ambient"]),
    position: asEnum(item.position, undefined, ["center", "top", "bottom", "left", "right"]),
    blur: typeof item.blur === "number" ? asNumber(item.blur, 0, 0, 24) : undefined,
    dim: typeof item.dim === "number" ? asNumber(item.dim, 0.28, 0, 0.75) : undefined,
    brightness: typeof item.brightness === "number" ? asNumber(item.brightness, 1, 0.55, 1.25) : undefined,
    overlay: asEnum(item.overlay, undefined, ["none", "vignette", "soft"])
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function makeThumbnail(blob, maxSize = 96, quality = 0.72) {
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

function getBootPreview(item) {
  return item.previewDataUrl ?? item.thumbDataUrl;
}

async function createWallpaperAssets(blob) {
  const [thumbDataUrl, previewDataUrl, contentHash] = await Promise.all([
    makeThumbnail(blob, 96, 0.72),
    makeThumbnail(blob, 640, 0.62),
    hashBlob(blob)
  ]);
  return { thumbDataUrl, previewDataUrl, contentHash };
}

async function makeWallpaperPalette(blob, maxSize = 36) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    bitmap.close();
    return ["#11191a", "#080d0e", "#101419"];
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const buckets = new Map();
  for (let index = 0; index < data.length; index += 16) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma < 18 || luma > 238) continue;
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const colors = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((bucket) => {
      const r = Math.round(bucket.r / bucket.count);
      const g = Math.round(bucket.g / bucket.count);
      const b = Math.round(bucket.b / bucket.count);
      return `rgb(${r} ${g} ${b})`;
    });
  return colors.length >= 2 ? colors : ["#11191a", "#080d0e", "#101419"];
}

function storeBootPreview(dataUrl, options = {}) {
  if (!dataUrl) return;
  const applyToPage = options.applyToPage ?? true;
  const persist = options.persist ?? true;
  if (persist) {
    try {
      localStorage.setItem(BOOT_PREVIEW_KEY, dataUrl);
    } catch {}
  }
  if (!applyToPage) return;
  document.documentElement.style.setProperty("--boot-wallpaper", `url("${dataUrl}")`);
  document.documentElement.classList.add("has-boot-wallpaper");
}

function getRotationItems() {
  return settings.wallpaper.rotationIds
    .map((id) => wallpapers.find((item) => item.id === id))
    .filter(Boolean);
}

function getRotationStatusText() {
  const count = getRotationItems().length;
  if (count >= 3) return `轮换池 ${count} 张：随机选择，任意连续 3 次不重复。`;
  if (count === 2) return "轮换池 2 张：会避免连续重复；至少 3 张可保证三张内不重复。";
  if (count === 1) return "轮换池 1 张：至少选择 3 张可保证三张内不重复。";
  return "未选择轮换壁纸：至少选择 3 张可启用随机且三张内不重复。";
}

function getRotationRecentLimit() {
  const rotationItems = getRotationItems();
  return Math.min(2, Math.max(0, rotationItems.length - 1));
}

function getValidRotationRecentIds() {
  const rotationIds = new Set(getRotationItems().map((item) => item.id));
  const ids = [settings.wallpaper.activeId, ...settings.wallpaper.rotationRecentIds].filter(Boolean);
  return Array.from(new Set(ids.filter((id) => rotationIds.has(id)))).slice(0, getRotationRecentLimit());
}

function getRandomIndex(max) {
  if (max <= 1) return 0;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % max;
}

function chooseRandomRotationItem(excludeIds = []) {
  const rotationItems = getRotationItems();
  if (rotationItems.length === 0) return undefined;
  const excluded = new Set(excludeIds);
  const candidates = rotationItems.filter((item) => !excluded.has(item.id));
  const pool = candidates.length > 0 ? candidates : rotationItems;
  return pool[getRandomIndex(pool.length)];
}

function getQueuedRotationItem() {
  const rotationItems = getRotationItems();
  return rotationItems.find((item) => item.id === settings.wallpaper.rotationNextId);
}

function getNextRotationItem() {
  return getQueuedRotationItem() ?? chooseRandomRotationItem(getValidRotationRecentIds());
}

function buildRotationState(activeId) {
  const rotationIds = new Set(getRotationItems().map((item) => item.id));
  const recentIds = Array.from(
    new Set([activeId, ...settings.wallpaper.rotationRecentIds].filter((id) => id && rotationIds.has(id)))
  ).slice(0, getRotationRecentLimit());
  const nextItem = chooseRandomRotationItem(recentIds);
  return {
    activeId,
    rotationRecentIds: recentIds,
    rotationNextId: nextItem?.id
  };
}

function sanitizeRotationState(wallpaperSettings, availableWallpapers = wallpapers) {
  const availableIds = new Set(availableWallpapers.map((item) => item.id));
  const rotationIds = Array.from(new Set(wallpaperSettings.rotationIds.filter((id) => availableIds.has(id))));
  const rotationSet = new Set(rotationIds);
  const activeId = wallpaperSettings.activeId && availableIds.has(wallpaperSettings.activeId) ? wallpaperSettings.activeId : availableWallpapers[0]?.id;
  const limit = Math.min(2, Math.max(0, rotationIds.length - 1));
  const rotationRecentIds = Array.from(
    new Set(wallpaperSettings.rotationRecentIds.filter((id) => rotationSet.has(id)))
  ).slice(0, limit);
  const rotationNextId = rotationSet.has(wallpaperSettings.rotationNextId) ? wallpaperSettings.rotationNextId : undefined;
  return {
    ...wallpaperSettings,
    activeId,
    rotationIds,
    rotationRecentIds,
    rotationNextId
  };
}

function primeNextRotationBootPreview() {
  if (settings.wallpaper.source !== "rotation") {
    releasePreheatedWallpaper();
    return;
  }
  const nextItem = getQueuedRotationItem() ?? chooseRandomRotationItem(getValidRotationRecentIds());
  const nextPreview = nextItem ? getBootPreview(nextItem) : undefined;
  if (nextPreview) storeBootPreview(nextPreview, { applyToPage: false });
  schedulePreheatNextRotationWallpaper(nextItem);
}

function emitWallpaperPreheatEvent(type, itemId) {
  window.dispatchEvent(new CustomEvent("tab-wallpaper-preheat", { detail: { type, itemId } }));
}

function releasePreheatedWallpaper(keepUrl = "") {
  if (preheatedWallpaperUrl && preheatedWallpaperUrl !== keepUrl) {
    URL.revokeObjectURL(preheatedWallpaperUrl);
  }
  preheatedWallpaperId = "";
  preheatedWallpaperUrl = "";
}

function consumePreheatedWallpaper(itemId) {
  if (preheatedWallpaperId !== itemId || !preheatedWallpaperUrl) return undefined;
  const url = preheatedWallpaperUrl;
  preheatedWallpaperId = "";
  preheatedWallpaperUrl = "";
  emitWallpaperPreheatEvent("consume", itemId);
  return url;
}

function schedulePreheatNextRotationWallpaper(nextItem = getQueuedRotationItem()) {
  if (!nextItem) {
    releasePreheatedWallpaper();
    return;
  }
  if (preheatedWallpaperId === nextItem.id && preheatedWallpaperUrl) return;
  preheatedWallpaperPromise = preheatedWallpaperPromise
    .then(() => preheatRotationWallpaper(nextItem))
    .catch(() => {});
}

async function preheatRotationWallpaper(item) {
  if (settings.wallpaper.source !== "rotation") {
    releasePreheatedWallpaper();
    return;
  }
  const queuedItem = getQueuedRotationItem();
  if (!queuedItem || queuedItem.id !== item.id) return;
  const blob = await getWallpaperBlob(item.blobId);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
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

async function applyLayoutPreset(preset) {
  const presets = {
    minimal: {
      search: { ...settings.search, visibility: "hover", style: "line" },
      layout: { ...settings.layout, searchPosition: "center", showShortcuts: false, shortcutVisibility: "hidden" },
      theme: { ...settings.theme, panelTransparency: 0.62 }
    },
    balanced: {
      search: { ...settings.search, visibility: "always", style: "glass" },
      layout: { ...settings.layout, searchPosition: "center", showShortcuts: true, shortcutDensity: "comfortable", shortcutVisibility: "always" },
      theme: { ...settings.theme, panelTransparency: 0.72 }
    },
    quick: {
      search: { ...settings.search, visibility: "always", style: "glass" },
      layout: { ...settings.layout, searchPosition: "upper", showShortcuts: true, shortcutDensity: "dense", shortcutVisibility: "always" },
      theme: { ...settings.theme, panelTransparency: 0.82 }
    }
  };
  const patch = presets[preset];
  if (!patch) return;
  await saveSettings({ ...settings, ...patch });
  statusMessage = `已应用${preset === "minimal" ? "极简" : preset === "quick" ? "快捷入口" : "平衡"}布局。`;
  renderPanel();
}

async function importLocalWallpaper(file, options = {}) {
  const blob = options.blob ?? file.slice(0, file.size, file.type || "image/jpeg");
  const id = crypto.randomUUID();
  const assets = await createWallpaperAssets(blob);
  const { thumbDataUrl, previewDataUrl } = assets;
  const contentHash = options.contentHash ?? assets.contentHash;
  const item = {
    id,
    name: file.name.replace(/\.[^.]+$/, "") || "本地壁纸",
    source: "local",
    blobId: `blob-${id}`,
    thumbDataUrl,
    previewDataUrl,
    contentHash,
    createdAt: Date.now()
  };
  await saveWallpaper(item, blob);
  storeBootPreview(previewDataUrl);
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
  const { thumbDataUrl, previewDataUrl, contentHash } = await createWallpaperAssets(blob);
  const id = `bing-${image.hsh ?? new Date().toISOString().slice(0, 10)}`;
  const item = {
    id,
    name: image.title || "Bing 每日壁纸",
    source: "bing",
    blobId: `blob-${id}`,
    thumbDataUrl,
    previewDataUrl,
    contentHash,
    createdAt: Date.now(),
    attribution: image.copyright
  };
  await saveWallpaper(item, blob);
  storeBootPreview(previewDataUrl);
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

function openInNewTab(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function getSortedShortcuts() {
  return [...settings.shortcuts].sort((a, b) => a.order - b.order);
}

function getShortcutGroups() {
  const groups = new Map();
  for (const shortcut of getSortedShortcuts()) {
    const groupName = shortcut.group?.trim() || "";
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(shortcut);
  }
  return [...groups.entries()].map(([name, shortcuts]) => ({ name, shortcuts }));
}

function getActiveWallpaperItem() {
  return wallpapers.find((item) => item.id === settings.wallpaper.activeId);
}

function getActiveWallpaperDisplay() {
  const item = getActiveWallpaperItem();
  return {
    fit: item?.fit ?? settings.wallpaper.fit,
    position: item?.position ?? settings.wallpaper.position,
    blur: item?.blur ?? settings.wallpaper.blur,
    dim: item?.dim ?? settings.wallpaper.dim,
    brightness: item?.brightness ?? settings.wallpaper.brightness,
    overlay: item?.overlay ?? settings.wallpaper.overlay
  };
}

function navigateSearch(value) {
  const query = value.trim();
  if (!query) return;
  const activeEngine = searchEngines.find((engine) => engine.id === settings.search.engineId) ?? searchEngines[0];
  const template = settings.search.engineId === "custom" ? settings.search.customTemplate : activeEngine.template;
  const looksLikeUrl = /^([a-z]+:\/\/)?([\w-]+\.)+[\w-]{2,}(\/.*)?$/i.test(query);
  openInNewTab(looksLikeUrl ? normalizeUrl(query) : template.replace("{query}", encodeURIComponent(query)));
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
  const shortcutMatches = getSortedShortcuts().filter((s) =>
    s.name.toLowerCase().includes(lower) || s.url.toLowerCase().includes(lower)
  );
  const shortcutUrls = new Set(shortcutMatches.map((s) => s.url));
  const commonMatches = commonSites.filter((s) =>
    !shortcutUrls.has(s.url) && (s.name.toLowerCase().includes(lower) || s.url.toLowerCase().includes(lower))
  );
  const matches = [...shortcutMatches.map((s) => ({ name: s.name, url: s.url, icon: s.icon })), ...commonMatches];
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
      openInNewTab(shortcut.url);
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

async function waitForImageDecode(url, timeoutMs = 1200) {
  await new Promise((resolve) => {
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

async function resolveActiveWallpaper({ startup = false } = {}) {
  if (settings.wallpaper.source === "rotation") {
    const nextRotationItem = getNextRotationItem();
    if (nextRotationItem) {
      await applyRotationWallpaper(nextRotationItem, {
        updateMetadata: !startup,
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
      persistActiveId: !startup && preferred.id !== settings.wallpaper.activeId,
      updateMetadata: !startup,
      computePalette: false
    });
  } else if (settings.wallpaper.source === "bing") {
    if (startup) runWhenIdle(() => void refreshBingWallpaper());
    else await refreshBingWallpaper();
  }
}

async function applyRotationWallpaper(item, options = {}) {
  await setActiveWallpaper(item, {
    persistActiveId: false,
    updateMetadata: options.updateMetadata ?? true,
    computePalette: options.computePalette ?? false
  });
  await saveSettings({
    ...settings,
    wallpaper: {
      ...settings.wallpaper,
      source: "rotation",
      ...buildRotationState(item.id)
    }
  });
  primeNextRotationBootPreview();
}

async function setActiveWallpaper(item, options = {}) {
  const applyOptions =
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
  const nextUrl = preheatedUrl ?? URL.createObjectURL(blob);
  storeBootPreview(getBootPreview(item), { persist: settings.wallpaper.source !== "rotation" });
  wallpaperLoading = true;
  render();
  if (!preheatedUrl) await waitForImageDecode(nextUrl);
  activeWallpaperUrl = nextUrl;
  wallpaperLoading = false;
  if (previousUrl.startsWith("blob:")) {
    window.setTimeout(() => URL.revokeObjectURL(previousUrl), 250);
  }
  const applyPalette = (palette) => {
    ambientWallpaperBackground = [
      `radial-gradient(circle at 18% 12%, ${palette[0]} 0, transparent 34%)`,
      `radial-gradient(circle at 82% 78%, ${palette[1] ?? palette[0]} 0, transparent 36%)`,
      `linear-gradient(135deg, ${palette[2] ?? palette[0]}, #080d0e)`
    ].join(",");
  };
  if (applyOptions.computePalette) {
    applyPalette(await makeWallpaperPalette(blob));
  } else {
    runWhenIdle(() => {
      void makeWallpaperPalette(blob).then(applyPalette);
    });
  }
  if (applyOptions.updateMetadata) {
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
  if (applyOptions.persistActiveId) {
    await saveSettings({ ...settings, wallpaper: { ...settings.wallpaper, activeId: item.id } });
  } else {
    settings = normalizeSettings({ ...settings, wallpaper: { ...settings.wallpaper, activeId: item.id } });
    render();
  }
  primeNextRotationBootPreview();
}

async function refreshBingWallpaper() {
  statusMessage = "正在获取 Bing 壁纸...";
  renderPanel();
  try {
    const item = await fetchBingDailyWallpaper();
    wallpapers = await listWallpapers();
    await refreshWallpaperSummary();
    await saveSettings({
      ...settings,
      wallpaper: {
        ...settings.wallpaper,
        source: "bing",
        activeId: item.id,
        rotationIds: Array.from(new Set([...settings.wallpaper.rotationIds, item.id]))
      }
    });
    await setActiveWallpaper(item, { persistActiveId: false });
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
  await refreshWallpaperSummary();
  await saveSettings({
    ...settings,
    wallpaper: {
      ...settings.wallpaper,
      source: "local",
      activeId: item.id,
      rotationIds: Array.from(new Set([...settings.wallpaper.rotationIds, item.id]))
    }
  });
  await setActiveWallpaper(item, { persistActiveId: false });
  statusMessage = "本地壁纸已缓存。";
  renderPanel();
}

async function handleLocalWallpapers(files) {
  const imageFiles = [...files].filter((file) => file.type.startsWith("image/"));
  if (imageFiles.length === 0) return;
  statusMessage = "正在导入壁纸...";
  renderPanel();
  const existingHashes = new Set(wallpapers.map((item) => item.contentHash).filter(Boolean));
  const importedItems = [];
  let skipped = 0;
  for (const file of imageFiles) {
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
    statusMessage = skipped > 0 ? `已跳过 ${skipped} 张重复壁纸。` : "没有可导入的图片。";
    renderPanel();
    return;
  }
  wallpapers = await listWallpapers();
  await refreshWallpaperSummary();
  const activeItem = importedItems[0];
  await saveSettings({
    ...settings,
    wallpaper: {
      ...settings.wallpaper,
      source: "local",
      activeId: activeItem.id,
      rotationIds: Array.from(new Set([...settings.wallpaper.rotationIds, ...importedItems.map((item) => item.id)]))
    }
  });
  await setActiveWallpaper(activeItem, { persistActiveId: false });
  statusMessage = `已导入 ${importedItems.length} 张壁纸${skipped > 0 ? `，跳过 ${skipped} 张重复图片` : ""}。`;
  renderPanel();
}

async function removeWallpaper(item) {
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
  await saveSettings({
    ...settings,
    wallpaper: nextWallpaperSettings
  });
  if (nextActive) await setActiveWallpaper(nextActive, { persistActiveId: false });
  else activeWallpaperUrl = "";
  render();
}

async function cleanupBrokenWallpapers() {
  const deleted = await deleteBrokenWallpapers();
  wallpapers = await listWallpapers();
  await refreshWallpaperSummary();
  await saveSettings({
    ...settings,
    wallpaper: sanitizeRotationState(settings.wallpaper, wallpapers)
  });
  await resolveActiveWallpaper();
  statusMessage = deleted > 0 ? `已清理 ${deleted} 个不可用壁纸记录。` : "没有发现不可用壁纸记录。";
  renderPanel();
}

async function useWallpaperSource(source) {
  const shouldWaitForWallpaper = source === "rotation" && getRotationItems().length > 0;
  if (shouldWaitForWallpaper) {
    wallpaperLoading = true;
    render();
  }
  await saveSettings({ ...settings, wallpaper: { ...settings.wallpaper, source } });
  try {
    await resolveActiveWallpaper();
    primeNextRotationBootPreview();
  } finally {
    if (shouldWaitForWallpaper) {
      wallpaperLoading = false;
      render();
    }
  }
}

async function showNextRotationWallpaper() {
  await saveSettings({ ...settings, wallpaper: { ...settings.wallpaper, source: "rotation" } });
  const nextRotationItem = getNextRotationItem();
  if (nextRotationItem) await applyRotationWallpaper(nextRotationItem);
}

async function toggleWallpaperRotation(item, enabled) {
  const rotationIds = enabled
    ? Array.from(new Set([...settings.wallpaper.rotationIds, item.id]))
    : settings.wallpaper.rotationIds.filter((id) => id !== item.id);
  await saveSettings({ ...settings, wallpaper: sanitizeRotationState({ ...settings.wallpaper, rotationIds }) });
  primeNextRotationBootPreview();
}

async function updateWallpaperOverrides(item, patch) {
  wallpaperOverrideQueue = wallpaperOverrideQueue.then(async () => {
    const current = wallpapers.find((wallpaper) => wallpaper.id === item.id) ?? item;
    const next = { ...current, ...patch };
    await updateWallpaper(next);
    wallpapers = wallpapers.map((wallpaper) => (wallpaper.id === item.id ? next : wallpaper));
    render();
  });
  return wallpaperOverrideQueue;
}

async function resetWallpaperOverrides(item) {
  wallpaperOverrideQueue = wallpaperOverrideQueue.then(async () => {
    const current = wallpapers.find((wallpaper) => wallpaper.id === item.id) ?? item;
    const next = { ...current };
    delete next.fit;
    delete next.position;
    delete next.blur;
    delete next.dim;
    delete next.brightness;
    delete next.overlay;
    await updateWallpaper(next);
    wallpapers = wallpapers.map((wallpaper) => (wallpaper.id === item.id ? next : wallpaper));
    render();
  });
  return wallpaperOverrideQueue;
}

function openWallpaperOptionsDialog(item) {
  const current = wallpapers.find((wallpaper) => wallpaper.id === item.id) ?? item;
  dialogHost.innerHTML = `
    <div class="dialog-backdrop" role="presentation">
      <form class="dialog wallpaper-options-dialog">
        <header>
          <div>
            <h2>单张壁纸设置</h2>
            <p>${htmlEscape(current.name)}</p>
          </div>
          <button id="closeWallpaperOptions" type="button" aria-label="关闭">关闭</button>
        </header>
        <div class="wallpaper-options-preview">
          ${current.thumbDataUrl ? `<img alt="" src="${htmlEscape(current.thumbDataUrl)}" />` : ""}
          <span>${current.id === settings.wallpaper.activeId ? "当前使用中" : "单独覆盖全局壁纸效果"}</span>
        </div>
        <label>填充方式
          <select id="wallpaperItemFit">
            <option value="">使用全局默认</option>
            <option value="ambient">完整显示 + 主色背景</option>
            <option value="cover">裁切铺满</option>
            <option value="contain">完整显示</option>
            <option value="fill">拉伸填满</option>
            <option value="blur">模糊填充</option>
          </select>
        </label>
        <label>居中方式
          <select id="wallpaperItemPosition">
            <option value="">使用全局默认</option>
            <option value="center">居中</option>
            <option value="top">顶部</option>
            <option value="bottom">底部</option>
            <option value="left">左侧</option>
            <option value="right">右侧</option>
          </select>
        </label>
        <label>叠层
          <select id="wallpaperItemOverlay">
            <option value="">使用全局默认</option>
            <option value="soft">柔和</option>
            <option value="vignette">暗角</option>
            <option value="none">无</option>
          </select>
        </label>
        <div class="wallpaper-option-range">
          <label>模糊 <input id="wallpaperItemBlur" type="range" min="0" max="24" step="1" /></label>
          <label class="inline"><input id="wallpaperItemBlurGlobal" type="checkbox" /> 使用全局</label>
        </div>
        <div class="wallpaper-option-range">
          <label>变暗 <input id="wallpaperItemDim" type="range" min="0" max="0.75" step="0.01" /></label>
          <label class="inline"><input id="wallpaperItemDimGlobal" type="checkbox" /> 使用全局</label>
        </div>
        <div class="wallpaper-option-range">
          <label>亮度 <input id="wallpaperItemBrightness" type="range" min="0.55" max="1.25" step="0.01" /></label>
          <label class="inline"><input id="wallpaperItemBrightnessGlobal" type="checkbox" /> 使用全局</label>
        </div>
        <div class="button-row">
          <button id="resetWallpaperItemOptions" type="button" class="small-danger">重置单张设置</button>
          <button type="button" id="doneWallpaperOptions">完成</button>
        </div>
      </form>
    </div>
  `;
  const $ = (id) => document.getElementById(id);
  const bindSelectOverride = (id, field) => {
    const element = $(id);
    element.value = current[field] ?? "";
    element.addEventListener("change", () => void updateWallpaperOverrides(current, { [field]: element.value || undefined }));
  };
  const bindRangeOverride = (field, fallback, inputId, globalId) => {
    const input = $(inputId);
    const global = $(globalId);
    input.value = String(current[field] ?? fallback);
    global.checked = current[field] === undefined;
    input.disabled = global.checked;
    input.addEventListener("input", () => {
      if (current.id !== settings.wallpaper.activeId || global.checked) return;
      const display = { ...getActiveWallpaperDisplay(), [field]: Number(input.value) };
      app.style.setProperty("--wallpaper-blur", `${display.blur}px`);
      app.style.setProperty("--wallpaper-dim", String(display.dim));
      app.style.setProperty("--wallpaper-brightness", String(display.brightness));
      wallpaperEl.style.filter = `blur(${display.blur}px) brightness(${display.brightness})`;
      if (wallpaperBackEl) wallpaperBackEl.style.filter = `blur(${display.blur}px) brightness(${display.brightness})`;
    });
    input.addEventListener("change", () => void updateWallpaperOverrides(current, { [field]: Number(input.value) }));
    global.addEventListener("change", () => {
      input.disabled = global.checked;
      void updateWallpaperOverrides(current, { [field]: global.checked ? undefined : Number(input.value) });
    });
  };
  bindSelectOverride("wallpaperItemFit", "fit");
  bindSelectOverride("wallpaperItemPosition", "position");
  bindSelectOverride("wallpaperItemOverlay", "overlay");
  bindRangeOverride("blur", settings.wallpaper.blur, "wallpaperItemBlur", "wallpaperItemBlurGlobal");
  bindRangeOverride("dim", settings.wallpaper.dim, "wallpaperItemDim", "wallpaperItemDimGlobal");
  bindRangeOverride("brightness", settings.wallpaper.brightness, "wallpaperItemBrightness", "wallpaperItemBrightnessGlobal");
  $("resetWallpaperItemOptions").addEventListener("click", () => void resetWallpaperOverrides(current));
  $("closeWallpaperOptions").addEventListener("click", closeDialog);
  $("doneWallpaperOptions").addEventListener("click", closeDialog);
  dialogHost.querySelector(".dialog-backdrop").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeDialog();
  });
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

async function renameShortcutGroup(oldName, newName) {
  const normalized = newName.trim();
  if (!oldName || !normalized || normalized === oldName) return;
  await saveSettings({
    ...settings,
    shortcuts: settings.shortcuts.map((shortcut) =>
      shortcut.group === oldName ? { ...shortcut, group: normalized } : shortcut
    )
  });
}

async function deleteShortcutGroup(groupName) {
  if (!groupName) return;
  await saveSettings({
    ...settings,
    shortcuts: settings.shortcuts.map((shortcut) =>
      shortcut.group === groupName ? { ...shortcut, group: undefined } : shortcut
    )
  });
}

async function moveManagedShortcutToGroup(groupName) {
  if (!managedDraggedShortcutId) return;
  await saveSettings({
    ...settings,
    shortcuts: settings.shortcuts.map((shortcut) =>
      shortcut.id === managedDraggedShortcutId ? { ...shortcut, group: groupName || undefined } : shortcut
    )
  });
  managedDraggedShortcutId = "";
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
  const wallpaperDisplay = getActiveWallpaperDisplay();
  const resolvedTheme = getResolvedTheme();
  app.classList.toggle("wallpaper-loading", wallpaperLoading || !activeWallpaperUrl);
  app.classList.toggle("theme-light", resolvedTheme === "light");
  app.classList.toggle("theme-dark", resolvedTheme === "dark");
  app.style.setProperty("--wallpaper-url", activeWallpaperUrl ? `url("${activeWallpaperUrl}")` : "var(--boot-wallpaper)");
  app.style.setProperty("--ambient-wallpaper-bg", ambientWallpaperBackground || "var(--boot-wallpaper)");
  app.style.setProperty("--wallpaper-position", wallpaperDisplay.position);
  app.style.setProperty("--wallpaper-blur", `${wallpaperDisplay.blur}px`);
  app.style.setProperty("--wallpaper-dim", String(wallpaperDisplay.dim));
  app.style.setProperty("--wallpaper-brightness", String(wallpaperDisplay.brightness));
  wallpaperEl.style.filter = `blur(${wallpaperDisplay.blur}px) brightness(${wallpaperDisplay.brightness})`;
  if (wallpaperBackEl) {
    wallpaperBackEl.style.filter = `blur(${wallpaperDisplay.blur}px) brightness(${wallpaperDisplay.brightness})`;
  }
  app.style.setProperty("--accent", settings.theme.accentColor);
  app.style.setProperty("--icon-opacity", String(settings.theme.iconOpacity));
  app.style.setProperty("--panel-alpha", String(settings.theme.panelTransparency));

  wallpaperEl.classList.toggle("overlay-soft", wallpaperDisplay.overlay === "soft");
  wallpaperEl.classList.toggle("overlay-vignette", wallpaperDisplay.overlay === "vignette");
  wallpaperEl.classList.toggle("fit-cover", wallpaperDisplay.fit === "cover");
  wallpaperEl.classList.toggle("fit-contain", wallpaperDisplay.fit === "contain");
  wallpaperEl.classList.toggle("fit-fill", wallpaperDisplay.fit === "fill");
  wallpaperEl.classList.toggle("fit-blur", wallpaperDisplay.fit === "blur");
  wallpaperEl.classList.toggle("fit-ambient", wallpaperDisplay.fit === "ambient");
  if (wallpaperBlurFillEl) {
    wallpaperBlurFillEl.classList.toggle("visible", wallpaperDisplay.fit === "blur");
    wallpaperBlurFillEl.classList.toggle("hidden", wallpaperDisplay.fit !== "blur");
  }
  if (wallpaperAmbientFillEl) {
    wallpaperAmbientFillEl.classList.toggle("visible", wallpaperDisplay.fit === "ambient");
    wallpaperAmbientFillEl.classList.toggle("hidden", wallpaperDisplay.fit !== "ambient");
  }

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
  clearBootClasses();
}

function clearBootClasses() {
  document.documentElement.classList.remove(
    "boot-theme-light",
    "boot-theme-dark",
    "boot-fit-cover",
    "boot-fit-contain",
    "boot-fit-fill",
    "boot-fit-blur",
    "boot-fit-ambient",
    "boot-overlay-none",
    "boot-overlay-soft",
    "boot-overlay-vignette",
    "boot-pos-upper",
    "boot-pos-center",
    "boot-pos-lower",
    "boot-search-hidden",
    "boot-search-hover",
    "boot-search-solid",
    "boot-search-line",
    "boot-shortcuts-hidden",
    "boot-shortcuts-hover",
    "boot-shortcuts-compact",
    "boot-shortcuts-dense"
  );
}

function renderShortcuts() {
  shortcutsEl.replaceChildren();
  const sorted = getSortedShortcuts();
  getShortcutGroups().forEach((group) => {
    if (group.name) {
      const title = document.createElement("h3");
      title.className = "shortcut-group-title";
      title.textContent = group.name;
      shortcutsEl.append(title);
    }
    group.shortcuts.forEach((shortcut) => {
      const index = sorted.findIndex((item) => item.id === shortcut.id);
      const anchor = document.createElement("a");
      anchor.className = "shortcut";
      anchor.href = shortcut.url;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
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
  const prevList = document.getElementById("wallpaperList");
  const savedScroll = prevList ? prevList.scrollTop : 0;
  settingsPanel.innerHTML = `
    <header>
      <h2>设置</h2>
      <button id="closeSettings" type="button">关闭</button>
    </header>
    <div class="panel-section">
      <h3>壁纸</h3>
      <div class="button-row">
        <button id="bingButton" type="button">Bing 每日壁纸</button>
        <label class="file-button">上传 <input id="wallpaperUpload" accept="image/*" multiple type="file" /></label>
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
      <p class="status">壁纸 ${wallpaperSummary.count} 张，占用 ${formatBytes(wallpaperSummary.bytes)}${wallpaperSummary.missing > 0 ? `，${wallpaperSummary.missing} 个记录缺少图片数据` : ""}</p>
      <button id="cleanupWallpapers" type="button">清理不可用壁纸记录</button>
      <p id="rotationStatus" class="status rotation-status">${htmlEscape(getRotationStatusText())}</p>
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
          <option value="ambient">完整显示 + 主色背景</option>
          <option value="cover">裁切铺满</option>
          <option value="contain">完整显示</option>
          <option value="fill">拉伸填满</option>
          <option value="blur">模糊填充</option>
        </select>
      </label>
      <label>壁纸位置
        <select id="wallpaperPosition">
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
      <details class="compact-details">
        <summary>管理已添加快捷方式（${getSortedShortcuts().length}）</summary>
        <div id="shortcutEditorList" class="shortcut-editor-list"></div>
      </details>
    </div>
    <div class="panel-section">
      <h3>布局</h3>
      <div class="button-row">
        <button id="presetMinimal" type="button">极简</button>
        <button id="presetBalanced" type="button">平衡</button>
        <button id="presetQuick" type="button">快捷入口</button>
      </div>
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
  bindPanelControls(savedScroll);
}

function bindPanelControls(savedScroll) {
  const $ = (id) => document.getElementById(id);
  const s = (id, fn) => { const el = $(id); if (el) fn(el); };
  s("closeSettings", (el) => el.addEventListener("click", closeSettings));
  s("bingButton", (el) => el.addEventListener("click", () => void refreshBingWallpaper()));
  s("nextWallpaper", (el) => el.addEventListener("click", () => void showNextRotationWallpaper()));
  s("cleanupWallpapers", (el) => el.addEventListener("click", () => void cleanupBrokenWallpapers()));
  s("wallpaperUpload", (el) => el.addEventListener("change", (event) => {
    const files = event.currentTarget.files;
    if (files?.length) void handleLocalWallpapers(files);
    event.currentTarget.value = "";
  }));

  s("wallpaperSource", (el) => {
    el.value = settings.wallpaper.source;
    el.addEventListener("change", () => void useWallpaperSource(el.value));
  });

  const wallpaperList = $("wallpaperList");
  wallpapers.forEach((item) => {
    const wrapper = document.createElement("div");
    wrapper.className = "wallpaper-item wallpaper-choice";
    wrapper.classList.toggle("active", item.id === settings.wallpaper.activeId);
    wrapper.dataset.wallpaperId = item.id;
    const thumbButton = document.createElement("button");
    thumbButton.type = "button";
    thumbButton.className = "wallpaper-thumb-button";
    thumbButton.ariaLabel = `使用 ${item.name}`;
    thumbButton.addEventListener("click", () => void setActiveWallpaper(item));
    const img = document.createElement("img");
    img.src = item.thumbDataUrl ?? "";
    img.alt = "";
    img.title = item.name;
    thumbButton.append(img);
    const name = document.createElement("span");
    name.textContent = item.name;
    const actions = document.createElement("div");
    actions.className = "wallpaper-item-actions";
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
    const itemMore = document.createElement("button");
    itemMore.type = "button";
    itemMore.className = "wallpaper-more-button";
    itemMore.textContent = "更多";
    itemMore.addEventListener("click", () => openWallpaperOptionsDialog(item));
    actions.append(rotateLabel, itemMore, remove);
    wrapper.append(thumbButton, name, actions);
    wallpaperList.append(wrapper);
  });
  if (savedScroll > 0) wallpaperList.scrollTop = savedScroll;

  s("wallpaperBlur", (el) => {
    el.value = settings.wallpaper.blur;
    el.addEventListener("input", () => {
      wallpaperEl.style.filter = `blur(${el.value}px) brightness(${$("wallpaperBrightness")?.value ?? 1})`;
    });
    el.addEventListener("change", () => void saveSettings({ ...settings, wallpaper: { ...settings.wallpaper, blur: Number(el.value) } }));
  });

  s("wallpaperDim", (el) => {
    el.value = settings.wallpaper.dim;
    el.addEventListener("input", () => {
      app.style.setProperty("--wallpaper-dim", el.value);
    });
    el.addEventListener("change", () => void saveSettings({ ...settings, wallpaper: { ...settings.wallpaper, dim: Number(el.value) } }));
  });

  s("wallpaperBrightness", (el) => {
    el.value = settings.wallpaper.brightness;
    el.addEventListener("input", () => {
      wallpaperEl.style.filter = `blur(${$("wallpaperBlur")?.value ?? 0}px) brightness(${el.value})`;
    });
    el.addEventListener("change", () => void saveSettings({ ...settings, wallpaper: { ...settings.wallpaper, brightness: Number(el.value) } }));
  });

  bindSelect("wallpaperOverlay", settings.wallpaper.overlay, (value) => ({ wallpaper: { ...settings.wallpaper, overlay: value } }));
  bindSelect("wallpaperFit", settings.wallpaper.fit, (value) => ({ wallpaper: { ...settings.wallpaper, fit: value } }));
  bindSelect("wallpaperPosition", settings.wallpaper.position, (value) => ({ wallpaper: { ...settings.wallpaper, position: value } }));

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
  const groupManager = document.createElement("div");
  groupManager.className = "shortcut-group-manager";
  getShortcutGroups().forEach((group) => {
    const section = document.createElement("section");
    section.className = "shortcut-manage-group";
    section.addEventListener("dragover", (event) => event.preventDefault());
    section.addEventListener("drop", (event) => {
      event.preventDefault();
      void moveManagedShortcutToGroup(group.name);
    });

    const header = document.createElement("header");
    if (group.name) {
      const nameInput = document.createElement("input");
      nameInput.value = group.name;
      nameInput.ariaLabel = "分组名称";
      nameInput.addEventListener("change", () => void renameShortcutGroup(group.name, nameInput.value));
      const deleteGroup = document.createElement("button");
      deleteGroup.type = "button";
      deleteGroup.textContent = "删除组";
      deleteGroup.addEventListener("click", () => void deleteShortcutGroup(group.name));
      header.append(nameInput, deleteGroup);
    } else {
      const label = document.createElement("strong");
      label.textContent = "默认";
      header.append(label);
    }
    const count = document.createElement("span");
    count.textContent = String(group.shortcuts.length);
    header.append(count);
    section.append(header);

    const list = document.createElement("div");
    list.className = "shortcut-editor-list";
    group.shortcuts.forEach((shortcut) => {
      const row = document.createElement("div");
      row.className = "shortcut-row";
      row.draggable = true;
      row.addEventListener("dragstart", () => {
        managedDraggedShortcutId = shortcut.id;
      });
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
      list.append(row);
    });
    section.append(list);
    groupManager.append(section);
  });
  shortcutEditorList.before(groupManager);
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
  s("presetMinimal", (el) => el.addEventListener("click", () => void applyLayoutPreset("minimal")));
  s("presetBalanced", (el) => el.addEventListener("click", () => void applyLayoutPreset("balanced")));
  s("presetQuick", (el) => el.addEventListener("click", () => void applyLayoutPreset("quick")));
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

  $("exportSettings").addEventListener("click", () => void exportSettings());
  $("importSettings").addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0];
    if (file) void importSettingsFile(file);
    event.currentTarget.value = "";
  });
}

function bindSetting(id, value, makePatch) {
  const element = document.getElementById(id);
  if (!element) return;
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
  if (!element) return;
  element.value = value;
  element.addEventListener("change", () => void saveSettings({ ...settings, ...makePatch(element.value) }));
}

function openSettings() {
  settingsPanel.classList.remove("hidden");
  renderPanel();
  void refreshWallpaperSummary().then(renderPanel);
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
  systemThemeMatcher?.addEventListener?.("change", render);
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
            openInNewTab(url);
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
      if (shortcut) openInNewTab(shortcut.url);
    }
  });
}

async function initialize() {
  bindEvents();
  settings = await loadSettings();
  render();
  wallpapers = await listWallpapers();
  render();
  runWhenIdle(() => void resolveActiveWallpaper({ startup: true }));
  runWhenIdle(() => void backfillWallpaperPreviews());
}

requestAnimationFrame(() => void initialize());
