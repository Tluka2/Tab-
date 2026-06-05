import { access, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
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
  browserChoice === "chrome"
    ? chromeCandidates
    : browserChoice === "edge"
      ? edgeCandidates
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
const smokeDir = join(root, ".browser-smoke", `bing-${runId}`);
await mkdir(smokeDir, { recursive: true });
const target = "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US";

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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Runtime evaluation failed");
  return result.result.value;
}

try {
  const port = await waitForDevToolsPort();
  let tabs = [];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    const tab = tabs.find((item) => item.url.startsWith("https://www.bing.com/HPImageArchive.aspx"));
    if (tab?.webSocketDebuggerUrl) {
      const ws = await connect(tab.webSocketDebuggerUrl);
      await send(ws, "Runtime.enable");
      let body = "";
      for (let bodyAttempt = 0; bodyAttempt < 80; bodyAttempt += 1) {
        body = await evaluate(ws, "document.body?.innerText ?? ''");
        if (body.trim()) break;
        await wait(100);
      }
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        throw new Error(`Bing response was not JSON. Network may be blocked. Body: ${body.slice(0, 160)}`);
      }
      const image = data.images?.[0];
      if (!image?.url) throw new Error(`Bing response missing image URL: ${body.slice(0, 200)}`);
      ws.close();
      console.log(`PASS Bing network smoke: ${browserPath}`);
      console.log(`PASS Bing image metadata: ${image.title ?? image.url}`);
      process.exitCode = 0;
      break;
    }
    await wait(100);
  }

  if (process.exitCode !== 0) {
    throw new Error(`Could not read Bing wallpaper response. Targets: ${tabs.map((item) => item.url).join(", ")}`);
  }
} finally {
  browser.kill();
  await Promise.race([browserExit, wait(1500)]);
}
