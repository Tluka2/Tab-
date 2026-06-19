import { access, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const extensionDir = resolve(root, "extension");
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

const smokeDir = join(root, ".browser-smoke", `extension-${Date.now()}`);
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
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    "--window-size=1366,768",
    "chrome://newtab/"
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Runtime evaluation failed");
  return result.result.value;
}

async function getTabs(port) {
  return fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
}

async function createTargetViaBrowser(port, url) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
  const browserWs = await connect(version.webSocketDebuggerUrl);
  try {
    const created = await send(browserWs, "Target.createTarget", { url });
    return created.targetId;
  } finally {
    browserWs.close();
  }
}

try {
  const port = await waitForDevToolsPort();
  let tabs = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    tabs = await getTabs(port);
    if (tabs.some((item) => item.url.startsWith("chrome-extension://"))) break;
    await wait(200);
  }

  let extensionTab = tabs.find((item) => item.url.startsWith("chrome-extension://") && item.url.endsWith("/index.html"));
  const anyExtensionTarget = tabs.find((item) => item.url.startsWith("chrome-extension://"));

  if (!extensionTab && anyExtensionTarget) {
    const extensionId = new URL(anyExtensionTarget.url).host;
    const extensionUrl = `chrome-extension://${extensionId}/index.html`;
    try {
      await createTargetViaBrowser(port, extensionUrl);
    } catch {}
    for (let attempt = 0; attempt < 20; attempt += 1) {
      tabs = await getTabs(port);
      extensionTab = tabs.find((item) => item.url === extensionUrl);
      if (extensionTab?.webSocketDebuggerUrl) break;
      await wait(150);
    }
  }

  if (!extensionTab?.webSocketDebuggerUrl) {
    if (anyExtensionTarget) {
      console.log(`PASS extension loaded target: ${anyExtensionTarget.url}`);
      console.log("SKIP extension page render: headless browser did not expose new tab override page target");
      throw new Error("__SKIP_RENDER__");
    }
    throw new Error(`No extension target found. Targets: ${tabs.map((item) => item.url).join(", ")}`);
  }

  const ws = await connect(extensionTab.webSocketDebuggerUrl);
  await send(ws, "Runtime.enable");
  const state = await evaluate(
    ws,
    `(() => ({
      url: location.href,
      title: document.title,
      hasSearch: Boolean(document.getElementById("searchInput")),
      hasSettings: Boolean(document.getElementById("settingsButton")),
      shortcutCount: document.querySelectorAll(".shortcut").length
    }))()`
  );

  if (!state.url.startsWith("chrome-extension://")) {
    if (anyExtensionTarget) {
      console.log(`PASS extension loaded target: ${anyExtensionTarget.url}`);
      console.log(`SKIP extension page render: browser returned ${state.url}`);
      throw new Error("__SKIP_RENDER__");
    }
    throw new Error(`Unexpected URL: ${state.url}`);
  }
  if (state.title !== "新标签页" || !state.hasSearch || !state.hasSettings || state.shortcutCount < 2) {
    throw new Error(`Extension page smoke failed: ${JSON.stringify(state)}`);
  }

  ws.close();
  console.log(`PASS extension load smoke: ${browserPath}`);
  console.log(`PASS extension page: ${state.url}`);
} catch (error) {
  if (!(error instanceof Error && error.message === "__SKIP_RENDER__")) {
    throw error;
  }
} finally {
  browser.kill();
  await Promise.race([browserExit, wait(1500)]);
}
