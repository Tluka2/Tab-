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

  const wallpaperFlow = await evaluate(
    ws,
    `(async () => {
      const input = document.getElementById("wallpaperUpload");
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const context = canvas.getContext("2d");
      context.fillStyle = "#70e1c8";
      context.fillRect(0, 0, 8, 8);
      context.fillStyle = "#17201d";
      context.fillRect(0, 0, 4, 4);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const file = new File([blob], "smoke-wallpaper.png", { type: "image/png" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 75));
        const choices = [...document.querySelectorAll(".wallpaper-choice")].map((item) => item.textContent.trim());
        const bootPreview = localStorage.getItem("tab.bootWallpaperPreview") ?? "";
        const status = document.querySelector(".status")?.textContent ?? "";
        if (choices.some((label) => label.includes("smoke-wallpaper")) && bootPreview.startsWith("data:image/jpeg")) {
          return { imported: true, choices, status, hasBootPreview: true };
        }
      }
      return {
        imported: false,
        choices: [...document.querySelectorAll(".wallpaper-choice")].map((item) => item.textContent.trim()),
        status: document.querySelector(".status")?.textContent ?? "",
        hasBootPreview: Boolean(localStorage.getItem("tab.bootWallpaperPreview"))
      };
    })()`
  );

  if (!wallpaperFlow.imported) {
    throw new Error(`Wallpaper upload flow failed: ${JSON.stringify(wallpaperFlow)}`);
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
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (location.hash === "#quick") {
          return { opened: true, hash: location.hash };
        }
      }
      return { opened: false, hash: location.hash };
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
      document.getElementById("searchForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (location.hash === "#search-hello%20world") {
          break;
        }
      }

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
      const slashFocus = document.activeElement?.id;

      return {
        ctrlKFocus,
        slashFocus,
        placeholder: searchInput.getAttribute("placeholder"),
        hash: location.hash
      };
    })()`
  );

  if (
    searchFlow.ctrlKFocus !== "searchInput" ||
    searchFlow.slashFocus !== "searchInput" ||
    searchFlow.placeholder !== "Smoke search" ||
    searchFlow.hash !== "#search-hello%20world"
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
