import { access, mkdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

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

const smokeDir = join(root, ".browser-smoke");
const runId = String(Date.now());
const profileDir = join(smokeDir, `profile-${runId}`);
await mkdir(profileDir, { recursive: true });

const target = `file:///${resolve(root, "extension", "index.html").replaceAll("\\", "/")}?v=${runId}`;
const viewports = [
  { name: "desktop", width: 1366, height: 768 },
  { name: "narrow", width: 390, height: 844 }
];

for (const viewport of viewports) {
  const screenshotPath = join(smokeDir, `${viewport.name}.png`);
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
    "--disable-features=VizDisplayCompositor",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${join(profileDir, viewport.name)}`,
    `--window-size=${viewport.width},${viewport.height}`,
    `--screenshot=${screenshotPath}`,
    target
  ];

  const result = spawnSync(browserPath, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 30000
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || `Browser exited with ${result.status}`);
    process.exit(result.status ?? 1);
  }

  const screenshot = await stat(screenshotPath).catch(() => undefined);
  if (!screenshot || screenshot.size < 1024) {
    console.error(`Screenshot was not created or is too small: ${screenshotPath}`);
    process.exit(1);
  }

  console.log(`PASS screenshot ${viewport.name}: ${screenshotPath} (${screenshot.size} bytes)`);
}

console.log(`PASS browser smoke: ${browserPath}`);
