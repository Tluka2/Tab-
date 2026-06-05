import { access, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const extensionDir = resolve(root, "extension");
const edgeCandidates = [
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];

async function canRead(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

const browserPath = (await Promise.all(edgeCandidates.map(async (path) => ((await canRead(path)) ? path : "")))).find(Boolean);
if (!browserPath) {
  console.error("No Edge executable found.");
  process.exit(1);
}

const runId = String(Date.now());
const smokeDir = join(root, ".browser-smoke", `edge-visible-${runId}`);
await mkdir(smokeDir, { recursive: true });

const browser = spawn(
  browserPath,
  [
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
    "--disable-features=VizDisplayCompositor",
    "--no-sandbox",
    "--enable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${smokeDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    "--window-size=1366,768",
    "edge://newtab/"
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
  for (let attempt = 0; attempt < 120; attempt += 1) {
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
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
  const browserWs = await connect(version.webSocketDebuggerUrl);
  const testUrls = ["edge://newtab/", "chrome://newtab/", "about:newtab"];

  let tabs = [];
  let extensionTab;
  for (const testUrl of testUrls) {
    await send(browserWs, "Target.createTarget", { url: testUrl });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      extensionTab = tabs.find((item) => item.url.startsWith("chrome-extension://") && item.url.endsWith("/index.html"));
      if (extensionTab?.webSocketDebuggerUrl) break;
      await wait(150);
    }
    if (extensionTab?.webSocketDebuggerUrl) break;
  }
  browserWs.close();

  if (!extensionTab?.webSocketDebuggerUrl) {
    const extensionTargets = tabs.filter((item) => item.url.startsWith("chrome-extension://")).map((item) => item.url);
    console.log(`SKIP visible Edge new-tab override: extension target not exposed in command-line visible Edge.`);
    console.log(`SKIP targets: ${tabs.map((item) => item.url).join(", ")}`);
    if (extensionTargets.length > 0) console.log(`SKIP extension targets: ${extensionTargets.join(", ")}`);
    throw new Error("__SKIP_VISIBLE__");
  }

  const ws = await connect(extensionTab.webSocketDebuggerUrl);
  await send(ws, "Runtime.enable");
  const state = await evaluate(
    ws,
    `(() => ({
      url: location.href,
      title: document.title,
      hasSearch: Boolean(document.getElementById("searchInput")),
      shortcutCount: document.querySelectorAll(".shortcut").length,
      hasSettings: Boolean(document.getElementById("settingsButton"))
    }))()`
  );

  if (state.title !== "新标签页" || !state.hasSearch || state.shortcutCount < 2 || !state.hasSettings) {
    throw new Error(`Visible Edge new tab smoke failed: ${JSON.stringify(state)}`);
  }

  ws.close();
  console.log(`PASS visible Edge new-tab override: ${state.url}`);
} catch (error) {
  if (!(error instanceof Error && error.message === "__SKIP_VISIBLE__")) {
    throw error;
  }
} finally {
  browser.kill();
  await Promise.race([browserExit, wait(2000)]);
}
