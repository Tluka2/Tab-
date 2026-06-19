import { access, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];
const edgeCandidates = [
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];
const browserChoice = process.env.SMOKE_BROWSER?.toLowerCase();
const candidates =
  browserChoice === "edge"
    ? edgeCandidates
    : browserChoice === "chrome"
      ? chromeCandidates
      : [...chromeCandidates, ...edgeCandidates];

async function canRead(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

const browserPath = (await Promise.all(candidates.map(async (path) => ((await canRead(path)) ? path : "")))).find(Boolean);
if (!browserPath) {
  console.error("No Chrome or Edge executable found.");
  process.exit(1);
}

const smokeDir = join(root, ".browser-smoke", `functional-${Date.now()}`);
await mkdir(smokeDir, { recursive: true });
const target = `file:///${resolve(root, "extension", "index.html").replaceAll("\\", "/")}?v=${Date.now()}`;

const browser = spawn(
  browserPath,
  [
    "--headless=new",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
    "--disable-features=VizDisplayCompositor",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${smokeDir}`,
    "--window-size=1366,768",
    target
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] }
);

let stderr = "";
browser.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDevToolsPort() {
  const portFile = join(smokeDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const [port] = (await readFile(portFile, "utf8")).trim().split(/\r?\n/);
      if (port) return port;
    } catch {}
    await wait(100);
  }
  throw new Error(`DevToolsActivePort was not created. ${stderr}`);
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
  });
}

let nextId = 1;
function send(ws, method, params = {}) {
  const id = nextId;
  nextId += 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    };
    ws.addEventListener("message", onMessage);
  });
}

async function evaluate(ws, expression) {
  const result = await send(ws, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    const detail =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.exception?.value ??
      result.exceptionDetails.text ??
      "Runtime evaluation failed";
    throw new Error(String(detail));
  }
  return result.result.value;
}

try {
  const port = await waitForDevToolsPort();
  const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const tab = tabs.find((item) => item.url.startsWith("file:///") && item.url.includes("/extension/index.html"));
  if (!tab?.webSocketDebuggerUrl) throw new Error("Could not find extension page target.");
  const ws = await connect(tab.webSocketDebuggerUrl);
  await send(ws, "Runtime.enable");
  await send(ws, "Page.enable");

  let initial;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    initial = await evaluate(
      ws,
      `(() => {
      const searchInput = document.getElementById("searchInput");
      const shortcuts = [...document.querySelectorAll(".shortcut")].map((item) => item.textContent.trim());
      return {
        title: document.title,
        hasSearch: Boolean(searchInput),
        placeholder: searchInput?.getAttribute("placeholder"),
        shortcutCount: shortcuts.length,
        hasSettings: Boolean(document.getElementById("settingsButton")),
        hasWallpaper: Boolean(document.getElementById("wallpaper")),
        bodyText: document.body?.innerText ?? ""
      };
    })()`
    );
    if (initial.hasSearch && initial.placeholder === "搜索或输入网址" && initial.shortcutCount >= 2) break;
    await wait(100);
  }

  if (initial.title !== "新标签页") throw new Error(`Unexpected title: ${initial.title}`);
  if (!initial.hasSearch || initial.placeholder !== "搜索或输入网址") throw new Error("Search input missing or wrong placeholder.");
  if (initial.shortcutCount < 2) throw new Error("Default shortcuts did not render.");
  if (!initial.hasSettings || !initial.hasWallpaper) throw new Error("Core shell controls missing.");

  const settingsPanel = await evaluate(
    ws,
    `(() => {
      document.getElementById("settingsButton").click();
      const panel = document.getElementById("settingsPanel");
      return {
        visible: !panel.classList.contains("hidden"),
        hasWallpaperUpload: Boolean(document.getElementById("wallpaperUpload")),
        hasSearchEngine: Boolean(document.getElementById("searchEngine")),
        hasAddShortcut: Boolean(document.getElementById("addShortcut")),
        hasExport: Boolean(document.getElementById("exportSettings")),
        hasKeyboardToggle: Boolean(document.getElementById("focusSearchShortcut"))
      };
    })()`
  );

  if (!Object.values(settingsPanel).every(Boolean)) {
    throw new Error(`Settings panel smoke failed: ${JSON.stringify(settingsPanel)}`);
  }

  const settingsApplyFlow = await evaluate(
    ws,
    `(async () => {
      const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
      const changeValue = async (id, value) => {
        const element = document.getElementById(id);
        element.value = value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        await wait();
      };
      const changeChecked = async (id, value) => {
        const element = document.getElementById(id);
        element.checked = value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        await wait();
      };

      await changeValue("searchStyle", "solid");
      await changeValue("searchPosition", "upper");
      const positionUpperClass = document.getElementById("workspace").className;
      await changeValue("searchPosition", "center");
      const positionCenterClass = document.getElementById("workspace").className;
      await changeValue("searchPosition", "lower");
      const positionLowerClass = document.getElementById("workspace").className;
      await changeValue("shortcutDensity", "dense");
      await changeChecked("showShortcuts", false);
      const hiddenAfterToggle = document.getElementById("shortcuts").hidden;
      await changeChecked("showShortcuts", true);
      await changeValue("themeMode", "dark");
      const darkTheme = {
        className: document.getElementById("app").className,
        color: getComputedStyle(document.getElementById("app")).color,
        panelBg: getComputedStyle(document.getElementById("settingsPanel")).backgroundColor
      };
      await changeValue("themeMode", "light");
      const lightTheme = {
        className: document.getElementById("app").className,
        color: getComputedStyle(document.getElementById("app")).color,
        panelBg: getComputedStyle(document.getElementById("settingsPanel")).backgroundColor
      };
      await changeValue("accentColor", "#ff3366");
      await changeValue("wallpaperBlur", "6");
      await changeValue("wallpaperDim", "0.42");
      await changeValue("wallpaperBrightness", "1.1");
      await changeValue("wallpaperOverlay", "vignette");

      const app = document.getElementById("app");
      const wallpaper = document.getElementById("wallpaper");
      return {
        searchSolid: document.getElementById("searchForm").classList.contains("solid"),
        positionUpper: positionUpperClass.includes("pos-upper"),
        positionCenter: positionCenterClass.includes("pos-center"),
        positionLower: positionLowerClass.includes("pos-lower"),
        densityDense: document.getElementById("shortcuts").classList.contains("density-dense"),
        hiddenAfterToggle,
        shortcutsVisibleAgain: !document.getElementById("shortcuts").hidden,
        themeLight: app.classList.contains("theme-light"),
        darkTheme,
        lightTheme,
        accent: app.style.getPropertyValue("--accent").trim(),
        blur: app.style.getPropertyValue("--wallpaper-blur").trim(),
        dim: app.style.getPropertyValue("--wallpaper-dim").trim(),
        brightness: app.style.getPropertyValue("--wallpaper-brightness").trim(),
        overlayVignette: wallpaper.classList.contains("overlay-vignette")
      };
    })()`
  );

  if (
    !settingsApplyFlow.searchSolid ||
    !settingsApplyFlow.positionUpper ||
    !settingsApplyFlow.positionCenter ||
    !settingsApplyFlow.positionLower ||
    !settingsApplyFlow.densityDense ||
    !settingsApplyFlow.hiddenAfterToggle ||
    !settingsApplyFlow.shortcutsVisibleAgain ||
    !settingsApplyFlow.themeLight ||
    !settingsApplyFlow.darkTheme.className.includes("theme-dark") ||
    !settingsApplyFlow.lightTheme.className.includes("theme-light") ||
    settingsApplyFlow.darkTheme.color === settingsApplyFlow.lightTheme.color ||
    settingsApplyFlow.darkTheme.panelBg === settingsApplyFlow.lightTheme.panelBg ||
    settingsApplyFlow.accent !== "#ff3366" ||
    settingsApplyFlow.blur !== "6px" ||
    settingsApplyFlow.dim !== "0.42" ||
    settingsApplyFlow.brightness !== "1.1" ||
    !settingsApplyFlow.overlayVignette
  ) {
    throw new Error(`Settings apply flow failed: ${JSON.stringify(settingsApplyFlow)}`);
  }

  await send(ws, "Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }]
  });
  const autoThemeFlow = await evaluate(
    ws,
    `(async () => {
      const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
      const themeMode = document.getElementById("themeMode");
      themeMode.value = "auto";
      themeMode.dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      const lightClass = document.getElementById("app").className;
      return {
        lightAuto: lightClass.includes("theme-light"),
        darkClassPresent: lightClass.includes("theme-dark")
      };
    })()`
  );
  await send(ws, "Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }]
  });
  const autoThemeDarkFlow = await evaluate(
    ws,
    `(async () => {
      const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
      const themeMode = document.getElementById("themeMode");
      themeMode.value = "dark";
      themeMode.dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      themeMode.value = "auto";
      themeMode.dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      return {
        darkAuto: document.getElementById("app").className.includes("theme-dark"),
        lightClassPresent: document.getElementById("app").className.includes("theme-light")
      };
    })()`
  );
  if (!autoThemeFlow.lightAuto || autoThemeFlow.darkClassPresent || !autoThemeDarkFlow.darkAuto || autoThemeDarkFlow.lightClassPresent) {
    throw new Error(`Auto theme flow failed: ${JSON.stringify({ autoThemeFlow, autoThemeDarkFlow })}`);
  }

  const layoutPresetFlow = await evaluate(
    ws,
    `(async () => {
      const wait = () => new Promise((resolve) => setTimeout(resolve, 100));
      document.getElementById("presetMinimal").click();
      await wait();
      const minimal = {
        searchHover: document.getElementById("searchForm").classList.contains("visibility-hover"),
        searchLine: document.getElementById("searchForm").classList.contains("line"),
        shortcutsHidden: document.getElementById("shortcuts").hidden
      };
      document.getElementById("presetBalanced").click();
      await wait();
      const balanced = {
        searchVisible: !document.getElementById("searchForm").classList.contains("visibility-hover") && !document.getElementById("searchForm").classList.contains("visibility-hidden"),
        searchGlass: !document.getElementById("searchForm").classList.contains("solid") && !document.getElementById("searchForm").classList.contains("line"),
        shortcutsVisible: !document.getElementById("shortcuts").hidden,
        center: document.getElementById("workspace").classList.contains("pos-center")
      };
      document.getElementById("presetQuick").click();
      await wait();
      const quick = {
        upper: document.getElementById("workspace").classList.contains("pos-upper"),
        dense: document.getElementById("shortcuts").classList.contains("density-dense"),
        shortcutsVisible: !document.getElementById("shortcuts").hidden
      };
      return { minimal, balanced, quick };
    })()`
  );

  if (
    !layoutPresetFlow.minimal.searchHover ||
    !layoutPresetFlow.minimal.searchLine ||
    !layoutPresetFlow.minimal.shortcutsHidden ||
    !layoutPresetFlow.balanced.searchVisible ||
    !layoutPresetFlow.balanced.searchGlass ||
    !layoutPresetFlow.balanced.shortcutsVisible ||
    !layoutPresetFlow.balanced.center ||
    !layoutPresetFlow.quick.upper ||
    !layoutPresetFlow.quick.dense ||
    !layoutPresetFlow.quick.shortcutsVisible
  ) {
    throw new Error(`Layout preset flow failed: ${JSON.stringify(layoutPresetFlow)}`);
  }

  const wallpaperFlow = await evaluate(
    ws,
    `(async () => {
      const input = document.getElementById("wallpaperUpload");
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 800;
      const context = canvas.getContext("2d");
      const gradient = context.createLinearGradient(0, 0, 1200, 800);
      gradient.addColorStop(0, "#70e1c8");
      gradient.addColorStop(1, "#17201d");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 1200, 800);
      context.fillStyle = "#ffffff";
      context.fillRect(120, 120, 260, 180);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const file = new File([blob], "smoke-wallpaper.png", { type: "image/png" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      const startedAt = performance.now();
      input.dispatchEvent(new Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 75));
        const choices = [...document.querySelectorAll(".wallpaper-choice")].map((item) => item.textContent.trim());
        const bootPreview = localStorage.getItem("tab.bootWallpaperPreview") ?? "";
        const status = document.querySelector(".status")?.textContent ?? "";
        const wallpaperLoading = document.getElementById("app").classList.contains("wallpaper-loading");
        if (choices.some((label) => label.includes("smoke-wallpaper")) && bootPreview.startsWith("data:image/jpeg") && !wallpaperLoading) {
          const image = new Image();
          const decoded = await new Promise((resolve) => {
            image.onload = () => resolve(true);
            image.onerror = () => resolve(false);
            image.src = bootPreview;
          });
          return {
            imported: decoded && image.naturalWidth >= 600,
            choices,
            status,
            hasBootPreview: true,
            wallpaperLoading,
            previewWidth: image.naturalWidth,
            previewHeight: image.naturalHeight,
            elapsed: performance.now() - startedAt
          };
        }
      }
      return {
        imported: false,
        choices: [...document.querySelectorAll(".wallpaper-choice")].map((item) => item.textContent.trim()),
        status: document.querySelector(".status")?.textContent ?? "",
        hasBootPreview: Boolean(localStorage.getItem("tab.bootWallpaperPreview")),
        wallpaperLoading: document.getElementById("app").classList.contains("wallpaper-loading"),
        elapsed: performance.now() - startedAt
      };
    })()`
  );

  if (!wallpaperFlow.imported || wallpaperFlow.wallpaperLoading || wallpaperFlow.elapsed > 4500) {
    throw new Error(`Wallpaper upload flow failed: ${JSON.stringify(wallpaperFlow)}`);
  }

  const wallpaperMoreFlow = await evaluate(
    ws,
    `(async () => {
      const wait = () => new Promise((resolve) => setTimeout(resolve, 90));
      const list = document.getElementById("wallpaperList");
      const settingsBefore = JSON.parse(localStorage.getItem("tab.settings") || "{}");
      const beforeRows = list.querySelectorAll(".wallpaper-item").length;
      const beforeChildren = list.children.length;
      const firstRow =
        list.querySelector('.wallpaper-item[data-wallpaper-id="' + settingsBefore.wallpaper.activeId + '"]') ||
        list.querySelector(".wallpaper-item");
      const beforeHeight = Math.round(firstRow.getBoundingClientRect().height);
      firstRow.querySelector(".wallpaper-more-button").click();
      await wait();
      const dialog = document.querySelector(".wallpaper-options-dialog");
      const afterRows = list.querySelectorAll(".wallpaper-item").length;
      const afterChildren = list.children.length;
      const afterHeight = Math.round(firstRow.getBoundingClientRect().height);
      const position = document.getElementById("wallpaperItemPosition");
      const fit = document.getElementById("wallpaperItemFit");
      const blur = document.getElementById("wallpaperItemBlur");
      const blurGlobal = document.getElementById("wallpaperItemBlurGlobal");
      position.value = "top";
      position.dispatchEvent(new Event("change", { bubbles: true }));
      if (blurGlobal.checked) {
        blurGlobal.checked = false;
        blurGlobal.dispatchEvent(new Event("change", { bubbles: true }));
        await wait();
      }
      blur.value = "9";
      blur.dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      await wait();
      const hasFit = Boolean(fit);
      const hasPosition = Boolean(position);
      const hasBlur = Boolean(blur);
      const settings = JSON.parse(localStorage.getItem("tab.settings") || "{}");
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("tab-wallpapers", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const active = await new Promise((resolve, reject) => {
        const tx = db.transaction("wallpapers", "readonly");
        const request = tx.objectStore("wallpapers").get(settings.wallpaper.activeId);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      document.getElementById("doneWallpaperOptions").click();
      return {
        hasDialog: Boolean(dialog),
        hasFit,
        hasPosition,
        hasBlur,
        rowsStable: beforeRows === afterRows && beforeChildren === afterChildren,
        heightStable: Math.abs(beforeHeight - afterHeight) <= 2,
        noInlineSettings: !list.querySelector(".wallpaper-item-settings"),
        activePosition: active?.position,
        activeBlur: active?.blur,
        appBlur: getComputedStyle(document.getElementById("app")).getPropertyValue("--wallpaper-blur").trim()
      };
    })()`
  );

  if (
    !wallpaperMoreFlow.hasDialog ||
    !wallpaperMoreFlow.hasFit ||
    !wallpaperMoreFlow.hasPosition ||
    !wallpaperMoreFlow.hasBlur ||
    !wallpaperMoreFlow.rowsStable ||
    !wallpaperMoreFlow.heightStable ||
    !wallpaperMoreFlow.noInlineSettings ||
    wallpaperMoreFlow.activePosition !== "top" ||
    wallpaperMoreFlow.activeBlur !== 9 ||
    wallpaperMoreFlow.appBlur !== "9px"
  ) {
    throw new Error(`Wallpaper more-options flow failed: ${JSON.stringify(wallpaperMoreFlow)}`);
  }

  const rotationBootPreviewFlow = await evaluate(
    ws,
    `(async () => {
      const input = document.getElementById("wallpaperUpload");
      const makeFile = async (name, start, end) => {
        const canvas = document.createElement("canvas");
        canvas.width = 960;
        canvas.height = 540;
        const context = canvas.getContext("2d");
        const gradient = context.createLinearGradient(0, 0, 960, 540);
        gradient.addColorStop(0, start);
        gradient.addColorStop(1, end);
        context.fillStyle = gradient;
        context.fillRect(0, 0, 960, 540);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        return new File([blob], name, { type: "image/png" });
      };
      const transfer = new DataTransfer();
      transfer.items.add(await makeFile("rotation-a.png", "#3147ff", "#11191a"));
      transfer.items.add(await makeFile("rotation-b.png", "#e85d75", "#11191a"));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 80; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 75));
        const labels = [...document.querySelectorAll(".wallpaper-choice")].map((item) => item.textContent.trim());
        const loading = document.getElementById("app").classList.contains("wallpaper-loading");
        if (labels.some((label) => label.includes("rotation-a")) && labels.some((label) => label.includes("rotation-b")) && !loading) break;
      }
      window.__rotationPreheatEvents = [];
      window.addEventListener("tab-wallpaper-preheat", (event) => {
        window.__rotationPreheatEvents.push(event.detail);
      });
      const source = document.getElementById("wallpaperSource");
      source.value = "rotation";
      source.dispatchEvent(new Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 80; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 75));
        if (!document.getElementById("app").classList.contains("wallpaper-loading")) break;
      }
      for (let attempt = 0; attempt < 80; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const currentSettings = JSON.parse(localStorage.getItem("tab.settings") || "{}");
        if (window.__rotationPreheatEvents.some((event) => event.type === "ready" && event.itemId === currentSettings.wallpaper?.rotationNextId)) break;
      }
      const settings = JSON.parse(localStorage.getItem("tab.settings") || "{}");
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("tab-wallpapers", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const wallpapers = await new Promise((resolve, reject) => {
        const tx = db.transaction("wallpapers", "readonly");
        const request = tx.objectStore("wallpapers").getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      const rotationItems = settings.wallpaper.rotationIds.map((id) => wallpapers.find((item) => item.id === id)).filter(Boolean);
      const activeItem = rotationItems.find((item) => item.id === settings.wallpaper.activeId);
      const nextItem = rotationItems.find((item) => item.id === settings.wallpaper.rotationNextId);
      const bootPreview = localStorage.getItem("tab.bootWallpaperPreview");
      return {
        rotationCount: rotationItems.length,
        rotationStatus: document.getElementById("rotationStatus")?.textContent || "",
        activeId: settings.wallpaper.activeId,
        recentIds: settings.wallpaper.rotationRecentIds,
        nextId: nextItem?.id,
        queuedId: settings.wallpaper.rotationNextId,
        preheatedQueued: window.__rotationPreheatEvents.some((event) => event.type === "ready" && event.itemId === settings.wallpaper.rotationNextId),
        bootMatchesNext: Boolean(nextItem?.previewDataUrl && bootPreview === nextItem.previewDataUrl),
        bootMatchesActive: Boolean(activeItem?.previewDataUrl && bootPreview === activeItem.previewDataUrl),
        bootMatchesAnyId: rotationItems.find((item) => item.previewDataUrl === bootPreview)?.id,
        nextHasPreview: Boolean(nextItem?.previewDataUrl),
        bootLength: bootPreview?.length ?? 0,
        source: settings.wallpaper.source
      };
    })()`
  );

  if (
    rotationBootPreviewFlow.source !== "rotation" ||
    rotationBootPreviewFlow.rotationCount < 3 ||
    !rotationBootPreviewFlow.rotationStatus.includes("轮换池") ||
    !rotationBootPreviewFlow.rotationStatus.includes("连续 3") ||
    !rotationBootPreviewFlow.queuedId ||
    !rotationBootPreviewFlow.preheatedQueued ||
    !rotationBootPreviewFlow.bootMatchesNext
  ) {
    throw new Error(`Rotation boot preview flow failed: ${JSON.stringify(rotationBootPreviewFlow)}`);
  }

  await send(ws, "Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.__rotationPreheatEvents = [];
      window.addEventListener("tab-wallpaper-preheat", (event) => {
        window.__rotationPreheatEvents.push(event.detail);
      });
    `
  });
  await send(ws, "Page.reload", { ignoreCache: true });
  const rotationReloadFlow = await evaluate(
    ws,
    `(async () => {
      const expectedActiveId = ${JSON.stringify(rotationBootPreviewFlow.queuedId)};
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 75));
        const settings = JSON.parse(localStorage.getItem("tab.settings") || "{}");
        const ready = document.getElementById("settingsButton") && !document.getElementById("app")?.classList.contains("wallpaper-loading");
        const preheatedQueued = window.__rotationPreheatEvents?.some((event) => event.type === "ready" && event.itemId === settings.wallpaper?.rotationNextId);
        if (ready && settings.wallpaper?.activeId === expectedActiveId && settings.wallpaper?.rotationNextId && preheatedQueued) {
          return {
            activeMatchesQueued: true,
            activeId: settings.wallpaper.activeId,
            queuedId: settings.wallpaper.rotationNextId,
            recentIds: settings.wallpaper.rotationRecentIds,
            preheatedQueued,
            source: settings.wallpaper.source
          };
        }
      }
      const settings = JSON.parse(localStorage.getItem("tab.settings") || "{}");
      return {
        activeMatchesQueued: settings.wallpaper?.activeId === expectedActiveId,
        activeId: settings.wallpaper?.activeId,
        expectedActiveId,
        queuedId: settings.wallpaper?.rotationNextId,
        recentIds: settings.wallpaper?.rotationRecentIds,
        preheatedQueued: window.__rotationPreheatEvents?.some((event) => event.type === "ready" && event.itemId === settings.wallpaper?.rotationNextId),
        source: settings.wallpaper?.source
      };
    })()`
  );

  if (
    rotationReloadFlow.source !== "rotation" ||
    !rotationReloadFlow.activeMatchesQueued ||
    !rotationReloadFlow.queuedId ||
    !rotationReloadFlow.preheatedQueued ||
    !Array.isArray(rotationReloadFlow.recentIds) ||
    rotationReloadFlow.recentIds[0] !== rotationReloadFlow.activeId
  ) {
    throw new Error(`Rotation reload flow failed: ${JSON.stringify(rotationReloadFlow)}`);
  }

  await evaluate(
    ws,
    `(() => {
      const button = document.getElementById("settingsButton");
      if (button && document.getElementById("settingsPanel")?.classList.contains("hidden")) button.click();
      return true;
    })()`
  );

  const randomRotationFlow = await evaluate(
    ws,
    `(async () => {
      const wait = () => new Promise((resolve) => setTimeout(resolve, 90));
      const seen = [];
      const consumedMatches = [];
      for (let index = 0; index < 8; index += 1) {
        const before = JSON.parse(localStorage.getItem("tab.settings") || "{}");
        const expectedConsumedId = before.wallpaper?.rotationNextId;
        document.getElementById("nextWallpaper").click();
        for (let attempt = 0; attempt < 80; attempt += 1) {
          await wait();
          const current = JSON.parse(localStorage.getItem("tab.settings") || "{}");
          if (!document.getElementById("app").classList.contains("wallpaper-loading") && current.wallpaper?.activeId === expectedConsumedId) break;
        }
        const settings = JSON.parse(localStorage.getItem("tab.settings") || "{}");
        seen.push(settings.wallpaper.activeId);
        consumedMatches.push(Boolean(expectedConsumedId && window.__rotationPreheatEvents?.some((event) => event.type === "consume" && event.itemId === expectedConsumedId)));
        for (let attempt = 0; attempt < 80; attempt += 1) {
          await wait();
          const next = JSON.parse(localStorage.getItem("tab.settings") || "{}");
          if (window.__rotationPreheatEvents?.some((event) => event.type === "ready" && event.itemId === next.wallpaper?.rotationNextId)) break;
        }
      }
      const windowsUnique = seen.every((_, index) => {
        const windowIds = seen.slice(Math.max(0, index - 2), index + 1);
        return new Set(windowIds).size === windowIds.length;
      });
      const settings = JSON.parse(localStorage.getItem("tab.settings") || "{}");
      return {
        seen,
        uniqueCount: new Set(seen).size,
        windowsUnique,
        consumedMatches,
        recentIds: settings.wallpaper.rotationRecentIds,
        queuedId: settings.wallpaper.rotationNextId
      };
    })()`
  );

  if (
    !randomRotationFlow.windowsUnique ||
    randomRotationFlow.uniqueCount < 3 ||
    !randomRotationFlow.queuedId ||
    !randomRotationFlow.consumedMatches?.every(Boolean)
  ) {
    throw new Error(`Random rotation flow failed: ${JSON.stringify(randomRotationFlow)}`);
  }

  const rotationStateCleanupFlow = await evaluate(
    ws,
    `(async () => {
      const wait = () => new Promise((resolve) => setTimeout(resolve, 90));
      const settings = JSON.parse(localStorage.getItem("tab.settings") || "{}");
      const removeId = settings.wallpaper.rotationNextId || settings.wallpaper.rotationIds.find((id) => id !== settings.wallpaper.activeId);
      settings.wallpaper.rotationRecentIds = [removeId, "missing-wallpaper-id", ...(settings.wallpaper.rotationRecentIds || [])];
      settings.wallpaper.rotationNextId = removeId;
      localStorage.setItem("tab.settings", JSON.stringify(settings));
      const checkbox = document.querySelector('.wallpaper-item[data-wallpaper-id="' + removeId + '"] input[type="checkbox"]');
      if (!checkbox) return { hasCheckbox: false, removeId };
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 80; attempt += 1) {
        await wait();
        const next = JSON.parse(localStorage.getItem("tab.settings") || "{}");
        if (!next.wallpaper.rotationIds.includes(removeId)) {
          return {
            hasCheckbox: true,
            removeId,
            removedFromRotation: !next.wallpaper.rotationIds.includes(removeId),
            removedFromRecent: !(next.wallpaper.rotationRecentIds || []).includes(removeId) && !(next.wallpaper.rotationRecentIds || []).includes("missing-wallpaper-id"),
            removedFromQueued: next.wallpaper.rotationNextId !== removeId,
            rotationStatus: document.getElementById("rotationStatus")?.textContent || ""
          };
        }
      }
      const next = JSON.parse(localStorage.getItem("tab.settings") || "{}");
      return {
        hasCheckbox: true,
        removeId,
        removedFromRotation: !next.wallpaper.rotationIds.includes(removeId),
        removedFromRecent: !(next.wallpaper.rotationRecentIds || []).includes(removeId) && !(next.wallpaper.rotationRecentIds || []).includes("missing-wallpaper-id"),
        removedFromQueued: next.wallpaper.rotationNextId !== removeId,
        rotationStatus: document.getElementById("rotationStatus")?.textContent || ""
      };
    })()`
  );

  if (
    !rotationStateCleanupFlow.hasCheckbox ||
    !rotationStateCleanupFlow.removedFromRotation ||
    !rotationStateCleanupFlow.removedFromRecent ||
    !rotationStateCleanupFlow.removedFromQueued ||
    !rotationStateCleanupFlow.rotationStatus.includes("至少 3")
  ) {
    throw new Error(`Rotation state cleanup flow failed: ${JSON.stringify(rotationStateCleanupFlow)}`);
  }

  const legacyPreviewBackfillFlow = await evaluate(
    ws,
    `(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 450;
      const context = canvas.getContext("2d");
      context.fillStyle = "#223344";
      context.fillRect(0, 0, 800, 450);
      context.fillStyle = "#70e1c8";
      context.fillRect(120, 80, 280, 180);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = 96;
      thumbCanvas.height = 54;
      thumbCanvas.getContext("2d").drawImage(canvas, 0, 0, 96, 54);
      const item = {
        id: "legacy-no-preview",
        name: "legacy-no-preview",
        source: "local",
        blobId: "blob-legacy-no-preview",
        thumbDataUrl: thumbCanvas.toDataURL("image/jpeg", 0.72),
        createdAt: Date.now()
      };
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("tab-wallpapers", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["wallpapers", "blobs"], "readwrite");
        tx.objectStore("wallpapers").put(item);
        tx.objectStore("blobs").put({ id: item.blobId, blob });
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve();
      });
      db.close();
      if (typeof backfillWallpaperPreviews !== "function") return { backfilled: false, reason: "missing function" };
      await backfillWallpaperPreviews(1);
      const db2 = await new Promise((resolve, reject) => {
        const request = indexedDB.open("tab-wallpapers", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const stored = await new Promise((resolve, reject) => {
        const tx = db2.transaction("wallpapers", "readonly");
        const request = tx.objectStore("wallpapers").get(item.id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      db2.close();
      const image = new Image();
      const decoded = await new Promise((resolve) => {
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = stored?.previewDataUrl ?? "";
      });
      return {
        backfilled: Boolean(decoded && stored?.previewDataUrl?.startsWith("data:image/jpeg") && image.naturalWidth >= 600),
        previewWidth: image.naturalWidth,
        previewHeight: image.naturalHeight
      };
    })()`
  );

  if (!legacyPreviewBackfillFlow.backfilled) {
    throw new Error(`Legacy preview backfill flow failed: ${JSON.stringify(legacyPreviewBackfillFlow)}`);
  }

  const importFlow = await evaluate(
    ws,
    `(async () => {
      const input = document.getElementById("importSettings");
      const payload = {
        app: "Tab",
        settings: {
          search: {
            engineId: "google",
            customTemplate: "https://www.google.com/search?q={query}",
            placeholder: "导入后的搜索占位",
            style: "glass"
          },
          layout: {
            searchPosition: "center",
            showShortcuts: true,
            shortcutDensity: "comfortable"
          },
          keyboard: {
            focusSearch: true,
            numberShortcuts: true
          }
        }
      };
      const file = new File([JSON.stringify(payload)], "smoke-settings.json", { type: "application/json" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const placeholder = document.getElementById("searchInput")?.getAttribute("placeholder");
        const status = document.querySelector(".status")?.textContent ?? "";
        if (placeholder === "导入后的搜索占位") {
          return { imported: true, placeholder, status };
        }
      }
      return {
        imported: false,
        placeholder: document.getElementById("searchInput")?.getAttribute("placeholder") ?? "",
        status: document.querySelector(".status")?.textContent ?? ""
      };
    })()`
  );

  if (!importFlow.imported) {
    throw new Error(`Settings import flow failed: ${JSON.stringify(importFlow)}`);
  }

  const unsafeWallpaperImportFlow = await evaluate(
    ws,
    `(async () => {
      const input = document.getElementById("importSettings");
      const countWallpapers = async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open("tab-wallpapers", 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        const count = await new Promise((resolve, reject) => {
          const tx = db.transaction("wallpapers", "readonly");
          const request = tx.objectStore("wallpapers").count();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        db.close();
        return count;
      };
      const before = await countWallpapers();
      const payload = {
        app: "Tab",
        settings: {
          search: { placeholder: "过滤非法壁纸导入", engineId: "google", customTemplate: "https://www.google.com/search?q={query}", style: "glass" }
        },
        wallpapers: [
          {
            item: { id: "unsafe-wallpaper", name: "Unsafe", source: "local", blobId: "blob-unsafe-wallpaper", createdAt: Date.now() },
            dataUrl: "data:text/plain;base64,SGVsbG8="
          }
        ]
      };
      const file = new File([JSON.stringify(payload)], "unsafe-wallpaper-import.json", { type: "application/json" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (document.getElementById("searchInput")?.getAttribute("placeholder") === "过滤非法壁纸导入") break;
      }
      const after = await countWallpapers();
      return {
        before,
        after,
        blocked: after === before,
        placeholder: document.getElementById("searchInput")?.getAttribute("placeholder")
      };
    })()`
  );

  if (!unsafeWallpaperImportFlow.blocked || unsafeWallpaperImportFlow.placeholder !== "过滤非法壁纸导入") {
    throw new Error(`Unsafe wallpaper import flow failed: ${JSON.stringify(unsafeWallpaperImportFlow)}`);
  }

  const shortcutDialog = await evaluate(
    ws,
    `(() => {
      document.getElementById("addShortcut").click();
      const dialog = document.querySelector(".dialog");
      const state = {
        visible: Boolean(dialog),
        hasName: Boolean(document.getElementById("shortcutName")),
        hasUrl: Boolean(document.getElementById("shortcutUrl")),
        hasIcon: Boolean(document.getElementById("shortcutIcon")),
        hasGroup: Boolean(document.getElementById("shortcutGroup"))
      };
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      state.closedByEscape = !document.querySelector(".dialog");
      return state;
    })()`
  );

  if (!Object.values(shortcutDialog).every(Boolean)) {
    throw new Error(`Shortcut dialog smoke failed: ${JSON.stringify(shortcutDialog)}`);
  }

  const addShortcutFlow = await evaluate(
    ws,
    `(async () => {
      document.getElementById("settingsButton").click();
      document.getElementById("addShortcut").click();
      document.getElementById("shortcutName").value = "Docs";
      document.getElementById("shortcutUrl").value = "example.com/docs";
      document.querySelector(".dialog").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const labels = [...document.querySelectorAll(".shortcut .shortcut-label")].map((item) => item.textContent);
        if (labels.includes("Docs")) {
          return {
            added: true,
            shortcutCount: labels.length,
            href: [...document.querySelectorAll(".shortcut")].find((item) => item.textContent.includes("Docs"))?.href
          };
        }
      }
      return {
        added: false,
        shortcutCount: document.querySelectorAll(".shortcut").length,
        href: ""
      };
    })()`
  );

  if (!addShortcutFlow.added || addShortcutFlow.shortcutCount < 3 || addShortcutFlow.href !== "https://example.com/docs") {
    throw new Error(`Add shortcut flow failed: ${JSON.stringify(addShortcutFlow)}`);
  }

  const reorderShortcutFlow = await evaluate(
    ws,
    `(async () => {
      const getAnchors = () => [...document.querySelectorAll(".shortcut")];
      const getLabels = () => getAnchors().map((item) => item.querySelector(".shortcut-label")?.textContent ?? "");
      const docs = getAnchors().find((item) => item.textContent.includes("Docs"));
      const first = getAnchors()[0];
      if (!docs || !first) return { reordered: false, labels: getLabels(), reason: "Missing drag source or target" };
      docs.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true }));
      first.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true }));
      first.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true }));
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const labels = getLabels();
        if (labels[0] === "Docs") return { reordered: true, labels };
      }
      return { reordered: false, labels: getLabels() };
    })()`
  );

  if (!reorderShortcutFlow.reordered) {
    throw new Error(`Reorder shortcut flow failed: ${JSON.stringify(reorderShortcutFlow)}`);
  }

  const editDeleteShortcutFlow = await evaluate(
    ws,
    `(async () => {
      const findEditorRow = (label) =>
        [...document.querySelectorAll(".shortcut-row")].find((row) => row.textContent.includes(label));

      let row = findEditorRow("Docs");
      if (!row) return { edited: false, deleted: false, reason: "Docs editor row missing" };
      row.querySelector("button").click();
      document.getElementById("shortcutName").value = "Docs Edited";
      document.querySelector(".dialog").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      let edited = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const labels = [...document.querySelectorAll(".shortcut .shortcut-label")].map((item) => item.textContent);
        if (labels.includes("Docs Edited") && !labels.includes("Docs")) {
          edited = true;
          break;
        }
      }

      row = findEditorRow("Docs Edited");
      if (!row) return { edited, deleted: false, reason: "Edited editor row missing" };
      const deleteButton = [...row.querySelectorAll("button")].find((button) => button.textContent === "删除");
      deleteButton.click();

      let deleted = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const labels = [...document.querySelectorAll(".shortcut .shortcut-label")].map((item) => item.textContent);
        if (!labels.includes("Docs Edited")) {
          deleted = true;
          break;
        }
      }

      return {
        edited,
        deleted,
        shortcutCount: document.querySelectorAll(".shortcut").length
      };
    })()`
  );

  if (!editDeleteShortcutFlow.edited || !editDeleteShortcutFlow.deleted || editDeleteShortcutFlow.shortcutCount !== 2) {
    throw new Error(`Edit/delete shortcut flow failed: ${JSON.stringify(editDeleteShortcutFlow)}`);
  }

  const numberShortcutFlow = await evaluate(
    ws,
    `(async () => {
      const input = document.getElementById("importSettings");
      const baseUrl = location.href.split("#")[0];
      const payload = {
        app: "Tab",
        settings: {
          shortcuts: [
            {
              id: "quick",
              name: "Quick",
              url: baseUrl + "#quick",
              order: 0
            }
          ],
          layout: {
            searchPosition: "center",
            showShortcuts: true,
            shortcutDensity: "comfortable"
          },
          keyboard: {
            focusSearch: true,
            numberShortcuts: true
          }
        }
      };
      const file = new File([JSON.stringify(payload)], "smoke-number-shortcut.json", { type: "application/json" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const labels = [...document.querySelectorAll(".shortcut .shortcut-label")].map((item) => item.textContent);
        if (labels[0] === "Quick") break;
      }
      document.getElementById("closeSettings").click();
      document.activeElement?.blur?.();
      const openedUrls = [];
      const originalOpen = window.open;
      window.open = (url) => {
        openedUrls.push(String(url));
        return null;
      };
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (openedUrls[0]?.endsWith("#quick")) {
          window.open = originalOpen;
          return { opened: true, openedUrl: openedUrls[0] };
        }
      }
      window.open = originalOpen;
      return { opened: false, openedUrl: openedUrls[0] ?? "" };
    })()`
  );

  if (!numberShortcutFlow.opened) {
    throw new Error(`Number shortcut flow failed: ${JSON.stringify(numberShortcutFlow)}`);
  }

  const searchFlow = await evaluate(
    ws,
    `(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
      const ctrlKFocus = document.activeElement?.id;

      const input = document.getElementById("importSettings");
      const baseUrl = location.href.split("#")[0];
      const payload = {
        app: "Tab",
        settings: {
          search: {
            engineId: "custom",
            customTemplate: baseUrl + "#search-{query}",
            placeholder: "Smoke search",
            style: "glass"
          },
          layout: {
            searchPosition: "center",
            showShortcuts: true,
            shortcutDensity: "comfortable"
          },
          keyboard: {
            focusSearch: true,
            numberShortcuts: true
          }
        }
      };
      const file = new File([JSON.stringify(payload)], "smoke-search-settings.json", { type: "application/json" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (document.getElementById("searchInput")?.getAttribute("placeholder") === "Smoke search") break;
      }

      const searchInput = document.getElementById("searchInput");
      searchInput.value = "hello world";
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      const openedUrls = [];
      const originalOpen = window.open;
      window.open = (url) => {
        openedUrls.push(String(url));
        return null;
      };
      document.getElementById("searchForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (openedUrls[0]?.endsWith("#search-hello%20world")) {
          break;
        }
      }
      window.open = originalOpen;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
      const slashFocus = document.activeElement?.id;

      return {
        ctrlKFocus,
        slashFocus,
        placeholder: searchInput.getAttribute("placeholder"),
        openedUrl: openedUrls[0] ?? ""
      };
    })()`
  );

  if (
    searchFlow.ctrlKFocus !== "searchInput" ||
    searchFlow.slashFocus !== "searchInput" ||
    searchFlow.placeholder !== "Smoke search" ||
    !searchFlow.openedUrl.endsWith("#search-hello%20world")
  ) {
    throw new Error(`Search and keyboard flow failed: ${JSON.stringify(searchFlow)}`);
  }

  ws.close();
  console.log(`PASS functional smoke: ${browserPath}`);
  console.log(
    "PASS initial shell, settings panel, visual settings apply, local wallpaper upload, settings import, search submit, shortcut add/edit/delete/reorder flows, number-key open, Esc close, and keyboard focus"
  );
} finally {
  browser.kill();
}
