import { access, mkdir, readFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { inflateSync } from "node:zlib";

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
      : [...edgeCandidates, ...chromeCandidates];

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

const runId = String(Date.now());
const target = `file:///${resolve(root, "extension", "index.html").replaceAll("\\", "/")}?v=${runId}`;

function makeBootPreviewDataUrl() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#70e1c8" offset="0"/>
        <stop stop-color="#17201d" offset="1"/>
      </linearGradient>
    </defs>
    <rect width="640" height="360" fill="url(#g)"/>
    <circle cx="500" cy="82" r="92" fill="#4f6dff" opacity=".42"/>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnBrowser(profileDir) {
  rmSync(join(profileDir, "DevToolsActivePort"), { force: true });
  rmSync(join(profileDir, "SingletonCookie"), { force: true });
  rmSync(join(profileDir, "SingletonLock"), { force: true });
  rmSync(join(profileDir, "SingletonSocket"), { force: true });
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
  const exit = new Promise((resolve) => browser.once("exit", resolve));
  return { browser, exit, getStderr: () => stderr };
}

async function waitForDevToolsPort(profileDir, getStderr) {
  const portFile = join(profileDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const [port] = (await readFile(portFile, "utf8")).trim().split(/\r?\n/);
      if (port) return port;
    } catch {}
    await wait(80);
  }
  throw new Error(`DevToolsActivePort was not created. ${getStderr()}`);
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

async function connectToPage(port) {
  const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const tab = tabs.find((item) => item.url.startsWith("file:///") && item.url.includes("/extension/index.html"));
  if (!tab?.webSocketDebuggerUrl) throw new Error("Could not find extension page target.");
  const ws = await connect(tab.webSocketDebuggerUrl);
  await send(ws, "Runtime.enable");
  await send(ws, "Page.enable");
  await send(ws, "Page.navigate", { url: target });
  await waitForPageStorage(ws);
  return ws;
}

async function waitForPageStorage(ws) {
  let lastState;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    lastState = await evaluate(
      ws,
      `(() => {
        try {
          localStorage.getItem("tab.bootWallpaperPreview");
          return { ok: true, href: location.href, readyState: document.readyState };
        } catch (error) {
          return { ok: false, href: location.href, readyState: document.readyState, message: String(error) };
        }
      })()`
    );
    if (lastState.ok && lastState.href.startsWith("file:///") && lastState.href.includes("/extension/index.html")) return;
    await wait(50);
  }
  throw new Error(`Target page storage was not available: ${JSON.stringify(lastState)}`);
}

function parsePng(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") throw new Error("Screenshot is not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  if (colorType !== 2 && colorType !== 6) throw new Error(`Unsupported PNG color type: ${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  const rows = [];
  let inputOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const raw = Buffer.from(inflated.subarray(inputOffset, inputOffset + stride));
    inputOffset += stride;
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let value = raw[x];
      if (filter === 1) value = (value + left) & 255;
      else if (filter === 2) value = (value + up) & 255;
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
      }
      row[x] = value;
    }
    rows.push(row);
    previous = row;
  }
  return { width, height, channels, rows };
}

function analyzeScreenshot(base64) {
  const png = parsePng(Buffer.from(base64, "base64"));
  let samples = 0;
  let white = 0;
  let lumaTotal = 0;
  for (let y = 0; y < png.height; y += 12) {
    const row = png.rows[y];
    for (let x = 0; x < png.width; x += 12) {
      const i = x * png.channels;
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (r > 245 && g > 245 && b > 245) white += 1;
      lumaTotal += luma;
      samples += 1;
    }
  }
  return {
    width: png.width,
    height: png.height,
    whiteRatio: white / samples,
    averageLuma: lumaTotal / samples
  };
}

async function withBrowser(profileDir, task) {
  await mkdir(profileDir, { recursive: true });
  const { browser, exit, getStderr } = spawnBrowser(profileDir);
  try {
    const port = await waitForDevToolsPort(profileDir, getStderr);
    const ws = await connectToPage(port);
    return await task(ws);
  } finally {
    browser.kill();
    await Promise.race([exit, wait(1500)]);
  }
}

const bootPreview = makeBootPreviewDataUrl();
async function captureFirstFrame(profileDir) {
  return withBrowser(profileDir, async (ws) => {
    await wait(40);
    const screenshot = await send(ws, "Page.captureScreenshot", { format: "png", fromSurface: true });
    const state = await evaluate(
      ws,
      `(() => ({
        elapsed: performance.now(),
        title: document.title,
        hasBootClass: document.documentElement.classList.contains("has-boot-wallpaper"),
        bootWallpaper: getComputedStyle(document.documentElement).getPropertyValue("--boot-wallpaper"),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        wallpaperBackImage: getComputedStyle(document.getElementById("wallpaperBack")).backgroundImage
      }))()`
    );
    return { state, pixels: analyzeScreenshot(screenshot.data) };
  });
}

function assertNotWhiteFrame(label, result) {
  if (result.pixels.whiteRatio > 0.08 || result.pixels.averageLuma > 230) {
    throw new Error(`${label} first frame looks too white: ${JSON.stringify(result)}`);
  }
}

const coldProfile = join(root, ".browser-smoke", `first-frame-cold-${runId}`);
const coldResult = await captureFirstFrame(coldProfile);
assertNotWhiteFrame("Cold", coldResult);
if (coldResult.state.hasBootClass || coldResult.state.bootWallpaper.includes("data:image")) {
  throw new Error(`Cold profile unexpectedly had boot preview state: ${JSON.stringify(coldResult.state)}`);
}

const warmProfile = join(root, ".browser-smoke", `first-frame-warm-${runId}`);
await withBrowser(warmProfile, async (ws) => {
  await evaluate(
    ws,
    `(() => {
      localStorage.setItem("tab.bootWallpaperPreview", ${JSON.stringify(bootPreview)});
      localStorage.setItem("tab.bootSettings", JSON.stringify({
        wallpaper: { fit: "cover", position: "center", blur: 0, dim: 0.18, brightness: 1, overlay: "soft" },
        search: { style: "glass", visibility: "always" },
        layout: { searchPosition: "center", showShortcuts: true, shortcutDensity: "comfortable", shortcutVisibility: "always" },
        theme: { mode: "dark", accentColor: "#70e1c8", iconOpacity: 0.9, panelTransparency: 0.72 }
      }));
    })()`
  );
});

const warmResult = await captureFirstFrame(warmProfile);
assertNotWhiteFrame("Warm", warmResult);
if (!warmResult.state.hasBootClass || !warmResult.state.bootWallpaper.includes("data:image")) {
  throw new Error(`Boot preview was not applied synchronously: ${JSON.stringify(warmResult.state)}`);
}

console.log(`PASS first-frame smoke: ${browserPath}`);
console.log(
  `PASS cold first-frame pixels: whiteRatio=${coldResult.pixels.whiteRatio.toFixed(
    4
  )} avgLuma=${coldResult.pixels.averageLuma.toFixed(1)} elapsed=${coldResult.state.elapsed.toFixed(1)}ms`
);
console.log(
  `PASS warm first-frame pixels: whiteRatio=${warmResult.pixels.whiteRatio.toFixed(
    4
  )} avgLuma=${warmResult.pixels.averageLuma.toFixed(
    1
  )} elapsed=${warmResult.state.elapsed.toFixed(1)}ms`
);
