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
const smokeDir = join(root, ".browser-smoke", `performance-${runId}`);
await mkdir(smokeDir, { recursive: true });
const target = `file:///${resolve(root, "extension", "index.html").replaceAll("\\", "/")}?v=${runId}`;

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

  let metrics;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    metrics = await evaluate(
      ws,
      `(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        const searchInput = document.getElementById("searchInput");
        const shortcuts = document.querySelectorAll(".shortcut").length;
        const elapsed = performance.now();
        return {
          elapsed,
          domContentLoaded: nav ? nav.domContentLoadedEventEnd : 0,
          loadEventEnd: nav ? nav.loadEventEnd : 0,
          hasSearch: Boolean(searchInput),
          shortcutCount: shortcuts,
          hasWallpaper: Boolean(document.getElementById("wallpaper"))
        };
      })()`
    );
    if (metrics.hasSearch && metrics.shortcutCount >= 2 && metrics.hasWallpaper && metrics.loadEventEnd > 0) break;
    await wait(50);
  }

  if (!metrics.hasSearch || metrics.shortcutCount < 2 || !metrics.hasWallpaper) {
    throw new Error(`Startup shell did not render: ${JSON.stringify(metrics)}`);
  }

  const domLimit = Number(process.env.SMOKE_DOM_MS ?? 1500);
  const loadLimit = Number(process.env.SMOKE_LOAD_MS ?? 2500);
  const elapsedLimit = Number(process.env.SMOKE_READY_MS ?? 3000);

  if (metrics.domContentLoaded > domLimit) {
    throw new Error(`DOMContentLoaded too slow: ${metrics.domContentLoaded.toFixed(1)}ms > ${domLimit}ms`);
  }
  if (metrics.loadEventEnd > loadLimit) {
    throw new Error(`Load event too slow: ${metrics.loadEventEnd.toFixed(1)}ms > ${loadLimit}ms`);
  }
  if (metrics.elapsed > elapsedLimit) {
    throw new Error(`Ready check too slow: ${metrics.elapsed.toFixed(1)}ms > ${elapsedLimit}ms`);
  }

  ws.close();
  console.log(`PASS performance smoke: ${browserPath}`);
  console.log(
    `PASS startup timings: dom=${metrics.domContentLoaded.toFixed(1)}ms load=${metrics.loadEventEnd.toFixed(
      1
    )}ms ready=${metrics.elapsed.toFixed(1)}ms`
  );
} finally {
  browser.kill();
  await Promise.race([browserExit, wait(1500)]);
}
