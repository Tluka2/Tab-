import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
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

const smokeRoot = join(root, ".browser-smoke");
const profileDir = join(smokeRoot, `wallpaper-options-${Date.now()}`);
await mkdir(profileDir, { recursive: true });
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
    `--user-data-dir=${profileDir}`,
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
  const portFile = join(profileDir, "DevToolsActivePort");
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

async function saveScreenshot(ws, name) {
  const screenshot = await send(ws, "Page.captureScreenshot", { format: "png", fromSurface: true });
  const path = join(smokeRoot, name);
  await writeFile(path, Buffer.from(screenshot.data, "base64"));
  const file = await stat(path);
  if (file.size < 1024) throw new Error(`Screenshot was too small: ${path}`);
  return { path, size: file.size };
}

try {
  const port = await waitForDevToolsPort();
  const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const tab = tabs.find((item) => item.url.startsWith("file:///") && item.url.includes("/extension/index.html"));
  if (!tab?.webSocketDebuggerUrl) throw new Error("Could not find extension page target.");
  const ws = await connect(tab.webSocketDebuggerUrl);
  await send(ws, "Runtime.enable");
  await send(ws, "Page.enable");

  const desktopState = await evaluate(
    ws,
    `(async () => {
      const wait = () => new Promise((resolve) => setTimeout(resolve, 90));
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (document.getElementById("settingsButton")) break;
        await wait();
      }
      document.getElementById("settingsButton").click();
      await wait();
      const input = document.getElementById("wallpaperUpload");
      const makeFile = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const context = canvas.getContext("2d");
        const gradient = context.createLinearGradient(0, 0, 1280, 720);
        gradient.addColorStop(0, "#18324d");
        gradient.addColorStop(0.5, "#70e1c8");
        gradient.addColorStop(1, "#101516");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 1280, 720);
        context.fillStyle = "rgba(255,255,255,0.18)";
        context.fillRect(130, 120, 360, 220);
        context.fillRect(780, 360, 280, 160);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        return new File([blob], "visual-options-wallpaper.png", { type: "image/png" });
      };
      const transfer = new DataTransfer();
      transfer.items.add(await makeFile());
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 80; attempt += 1) {
        await wait();
        const imported = [...document.querySelectorAll(".wallpaper-item")].some((item) => item.textContent.includes("visual-options-wallpaper"));
        const loading = document.getElementById("app").classList.contains("wallpaper-loading");
        if (imported && !loading) break;
      }
      await wait();
      const row = [...document.querySelectorAll(".wallpaper-item")].find((item) => item.textContent.includes("visual-options-wallpaper"));
      const rowHeightBefore = row.getBoundingClientRect().height;
      const childrenBefore = document.getElementById("wallpaperList").children.length;
      row.querySelector(".wallpaper-more-button").click();
      await wait();
      const dialog = document.querySelector(".wallpaper-options-dialog");
      const rowHeightAfter = row.getBoundingClientRect().height;
      const rect = dialog.getBoundingClientRect();
      return {
        hasDialog: Boolean(dialog),
        hasPreview: Boolean(dialog.querySelector(".wallpaper-options-preview img")),
        hasPosition: Boolean(document.getElementById("wallpaperItemPosition")),
        hasBlur: Boolean(document.getElementById("wallpaperItemBlur")),
        rowHeightStable: Math.abs(rowHeightAfter - rowHeightBefore) <= 2,
        childrenStable: document.getElementById("wallpaperList").children.length === childrenBefore,
        noHorizontalOverflow: rect.left >= 0 && rect.right <= window.innerWidth,
        noVerticalOverflow: rect.top >= 0 && rect.bottom <= window.innerHeight,
        noInlineSettings: !document.getElementById("wallpaperList").querySelector(".wallpaper-item-settings")
      };
    })()`
  );

  if (!Object.values(desktopState).every(Boolean)) {
    throw new Error(`Wallpaper options desktop visual state failed: ${JSON.stringify(desktopState)}`);
  }

  const desktopShot = await saveScreenshot(ws, "wallpaper-options-desktop.png");
  await send(ws, "Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await wait(180);

  const narrowState = await evaluate(
    ws,
    `(() => {
      const dialog = document.querySelector(".wallpaper-options-dialog");
      const rect = dialog.getBoundingClientRect();
      const actionRow = dialog.querySelector(".button-row").getBoundingClientRect();
      return {
        noHorizontalOverflow: rect.left >= 0 && rect.right <= window.innerWidth,
        visibleTop: rect.top >= 0,
        actionsVisible: actionRow.bottom <= window.innerHeight,
        dialogWidth: Math.round(rect.width),
        viewportWidth: window.innerWidth
      };
    })()`
  );

  if (!narrowState.noHorizontalOverflow || !narrowState.visibleTop || narrowState.dialogWidth > narrowState.viewportWidth) {
    throw new Error(`Wallpaper options narrow visual state failed: ${JSON.stringify(narrowState)}`);
  }

  const narrowShot = await saveScreenshot(ws, "wallpaper-options-narrow.png");
  console.log(`PASS wallpaper options visual desktop: ${desktopShot.path} (${desktopShot.size} bytes)`);
  console.log(`PASS wallpaper options visual narrow: ${narrowShot.path} (${narrowShot.size} bytes)`);
  console.log("PASS wallpaper options visual smoke");
  ws.close();
} finally {
  browser.kill();
}
