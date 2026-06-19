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
const smokeDir = join(root, ".browser-smoke", `rotation-memory-${runId}`);
const target = `file:///${resolve(root, "extension", "index.html").replaceAll("\\", "/")}?v=${runId}`;
await mkdir(smokeDir, { recursive: true });

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

const browserExit = new Promise((resolve) => {
  browser.once("exit", () => resolve());
});
let stderr = "";
browser.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDevToolsPort() {
  const portFile = join(smokeDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const [port] = (await readFile(portFile, "utf8")).trim().split(/\r?\n/);
      if (port) return port;
    } catch {}
    await wait(80);
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

function metricValue(metrics, name) {
  return metrics.metrics.find((metric) => metric.name === name)?.value ?? 0;
}

try {
  const port = await waitForDevToolsPort();
  const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const tab = tabs.find((item) => item.url.startsWith("file:///") && item.url.includes("/extension/index.html"));
  if (!tab?.webSocketDebuggerUrl) throw new Error("Could not find extension page target.");

  const ws = await connect(tab.webSocketDebuggerUrl);
  await send(ws, "Runtime.enable");
  await send(ws, "Page.enable");
  await send(ws, "Performance.enable");
  await send(ws, "HeapProfiler.enable");

  const summary = await evaluate(
    ws,
    `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (document.getElementById("settingsButton") && document.getElementById("searchInput")) break;
        await wait(50);
      }

      const liveUrls = new Set();
      const originalCreateObjectURL = URL.createObjectURL.bind(URL);
      const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
      window.__objectUrlStats = { created: 0, revoked: 0, liveUrls };
      URL.createObjectURL = (blob) => {
        const url = originalCreateObjectURL(blob);
        window.__objectUrlStats.created += 1;
        liveUrls.add(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        window.__objectUrlStats.revoked += 1;
        liveUrls.delete(url);
        return originalRevokeObjectURL(url);
      };

      window.__rotationPreheatEvents = [];
      window.addEventListener("tab-wallpaper-preheat", (event) => {
        window.__rotationPreheatEvents.push(event.detail);
      });

      const settingsButton = document.getElementById("settingsButton");
      if (document.getElementById("settingsPanel")?.classList.contains("hidden")) settingsButton.click();
      const input = document.getElementById("wallpaperUpload");
      const makeFile = async (name, start, end) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const context = canvas.getContext("2d");
        const gradient = context.createLinearGradient(0, 0, 1280, 720);
        gradient.addColorStop(0, start);
        gradient.addColorStop(1, end);
        context.fillStyle = gradient;
        context.fillRect(0, 0, 1280, 720);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        return new File([blob], name, { type: "image/png" });
      };
      const transfer = new DataTransfer();
      transfer.items.add(await makeFile("memory-a.png", "#1c66ff", "#0b1418"));
      transfer.items.add(await makeFile("memory-b.png", "#2bc9a5", "#161822"));
      transfer.items.add(await makeFile("memory-c.png", "#f58b4c", "#10151b"));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await wait(75);
        const labels = [...document.querySelectorAll(".wallpaper-choice")].map((item) => item.textContent.trim());
        const loading = document.getElementById("app").classList.contains("wallpaper-loading");
        if (labels.some((label) => label.includes("memory-a")) && labels.some((label) => label.includes("memory-c")) && !loading) break;
      }

      const source = document.getElementById("wallpaperSource");
      source.value = "rotation";
      source.dispatchEvent(new Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await wait(75);
        const settings = JSON.parse(localStorage.getItem("tab.settings") || "{}");
        const ready = window.__rotationPreheatEvents.some((event) => event.type === "ready" && event.itemId === settings.wallpaper?.rotationNextId);
        if (ready && !document.getElementById("app").classList.contains("wallpaper-loading")) break;
      }

      const seen = [];
      const consumedMatches = [];
      const loadingFailures = [];
      const rotationCount = 60;
      for (let index = 0; index < rotationCount; index += 1) {
        const before = JSON.parse(localStorage.getItem("tab.settings") || "{}");
        const expectedConsumedId = before.wallpaper?.rotationNextId;
        document.getElementById("nextWallpaper").click();
        let settled = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          await wait(45);
          const current = JSON.parse(localStorage.getItem("tab.settings") || "{}");
          if (!document.getElementById("app").classList.contains("wallpaper-loading") && current.wallpaper?.activeId === expectedConsumedId) {
            settled = true;
            break;
          }
        }
        if (!settled) loadingFailures.push({ index, expectedConsumedId });
        const settings = JSON.parse(localStorage.getItem("tab.settings") || "{}");
        seen.push(settings.wallpaper.activeId);
        consumedMatches.push(Boolean(expectedConsumedId && window.__rotationPreheatEvents.some((event) => event.type === "consume" && event.itemId === expectedConsumedId)));
        for (let attempt = 0; attempt < 100; attempt += 1) {
          await wait(35);
          const next = JSON.parse(localStorage.getItem("tab.settings") || "{}");
          const ready = window.__rotationPreheatEvents.some((event) => event.type === "ready" && event.itemId === next.wallpaper?.rotationNextId);
          if (ready) break;
        }
      }
      await wait(650);

      const windowsUnique = seen.every((_, index) => {
        const windowIds = seen.slice(Math.max(0, index - 2), index + 1);
        return new Set(windowIds).size === windowIds.length;
      });
      const settings = JSON.parse(localStorage.getItem("tab.settings") || "{}");
      return {
        rotationCount,
        seenCount: seen.length,
        uniqueCount: new Set(seen).size,
        windowsUnique,
        allConsumedFromPreheat: consumedMatches.every(Boolean),
        loadingFailures,
        source: settings.wallpaper?.source,
        queuedId: settings.wallpaper?.rotationNextId,
        liveObjectUrls: window.__objectUrlStats.liveUrls.size,
        createdObjectUrls: window.__objectUrlStats.created,
        revokedObjectUrls: window.__objectUrlStats.revoked
      };
    })()`
  );

  await send(ws, "HeapProfiler.collectGarbage");
  const beforeMetrics = await send(ws, "Performance.getMetrics");
  await wait(300);
  await send(ws, "HeapProfiler.collectGarbage");
  const afterMetrics = await send(ws, "Performance.getMetrics");
  const heapDelta = metricValue(afterMetrics, "JSHeapUsedSize") - metricValue(beforeMetrics, "JSHeapUsedSize");

  if (
    summary.source !== "rotation" ||
    summary.seenCount !== summary.rotationCount ||
    summary.uniqueCount < 3 ||
    !summary.windowsUnique ||
    !summary.allConsumedFromPreheat ||
    summary.loadingFailures.length > 0 ||
    !summary.queuedId ||
    summary.liveObjectUrls > 3 ||
    heapDelta > 5 * 1024 * 1024
  ) {
    throw new Error(`Rotation memory smoke failed: ${JSON.stringify({ summary, heapDelta })}`);
  }

  ws.close();
  console.log(`PASS rotation memory smoke: ${browserPath}`);
  console.log(
    `PASS rotation memory: rotations=${summary.rotationCount} liveObjectUrls=${summary.liveObjectUrls} created=${summary.createdObjectUrls} revoked=${summary.revokedObjectUrls} heapDelta=${heapDelta}`
  );
} finally {
  browser.kill();
  await Promise.race([browserExit, wait(1500)]);
}
