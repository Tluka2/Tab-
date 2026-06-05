import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const extensionDir = join(root, "extension");
const publicDir = join(root, "public");
const requiredFiles = ["manifest.json", "index.html", "styles.css", "app.js", "boot.js"];

const checks = [];

function pass(name) {
  checks.push({ name, ok: true });
}

function fail(name, detail) {
  checks.push({ name, ok: false, detail });
}

async function exists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function assertIncludes(source, needles, label) {
  const missing = needles.filter((needle) => !source.includes(needle));
  if (missing.length > 0) {
    fail(label, `Missing: ${missing.join(", ")}`);
  } else {
    pass(label);
  }
}

for (const file of requiredFiles) {
  const path = join(extensionDir, file);
  if (await exists(path)) pass(`required file: ${file}`);
  else fail(`required file: ${file}`, "File is missing");
}

async function verifyManifest(manifestPath, label) {
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);

  if (manifest.manifest_version === 3) pass(`${label}: Manifest V3`);
  else fail(`${label}: Manifest V3`, `Expected 3, found ${manifest.manifest_version}`);

  if (manifest.chrome_url_overrides?.newtab === "index.html") pass(`${label}: new tab override`);
  else fail(`${label}: new tab override`, "chrome_url_overrides.newtab must point to index.html");

  const permissions = manifest.permissions ?? [];
  const broadPermissions = permissions.filter((permission) => !["storage"].includes(permission));
  if (broadPermissions.length === 0) pass(`${label}: minimal permissions`);
  else fail(`${label}: minimal permissions`, `Unexpected permissions: ${broadPermissions.join(", ")}`);

  const hostPermissions = manifest.host_permissions ?? [];
  if (hostPermissions.length === 1 && hostPermissions[0] === "https://www.bing.com/*") pass(`${label}: Bing-only host permission`);
  else fail(`${label}: Bing-only host permission`, `Found: ${hostPermissions.join(", ") || "none"}`);

  const csp = manifest.content_security_policy?.extension_pages ?? "";
  if (
    csp.includes("script-src 'self'") &&
    csp.includes("connect-src 'self' https://www.bing.com") &&
    csp.includes("img-src 'self' data: blob: https:") &&
    !csp.includes("'unsafe-inline'")
  ) {
    pass(`${label}: extension CSP`);
  } else {
    fail(`${label}: extension CSP`, csp || "Missing extension_pages CSP");
  }
}

await verifyManifest(join(extensionDir, "manifest.json"), "direct extension");
await verifyManifest(join(publicDir, "manifest.json"), "Vite manifest");

const html = await readFile(join(extensionDir, "index.html"), "utf8");
if (!/<script\s*>/i.test(html) && !/\son[a-z]+\s*=/i.test(html)) pass("no inline HTML scripts or handlers");
else fail("no inline HTML scripts or handlers", "Inline script or event handler found");

assertIncludes(
  html,
  ['href="styles.css"', 'src="boot.js"', 'src="app.js"', 'id="wallpaperAttribution"'],
  "HTML references extension assets"
);

const appJs = await readFile(join(extensionDir, "app.js"), "utf8");
const bootJs = await readFile(join(extensionDir, "boot.js"), "utf8");

for (const file of ["app.js", "boot.js"]) {
  const result = spawnSync(process.execPath, ["--check", join(extensionDir, file)], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status === 0) pass(`JavaScript syntax: ${file}`);
  else fail(`JavaScript syntax: ${file}`, result.stderr.trim() || result.stdout.trim());
}

assertIncludes(
  appJs,
  [
    "indexedDB.open",
    "chrome.storage.local",
    "HPImageArchive.aspx",
    "createImageBitmap",
    "tab.bootWallpaperPreview",
    "searchEngines",
    "customTemplate",
    "dragstart",
    "numberShortcuts",
    "focusSearch",
    "toggleWallpaperRotation",
    "shortcutIcon",
    "exportSettings",
    "importSettingsFile",
    "normalizeShortcuts",
    "normalizeSettings",
    "normalizeSearchTemplate",
    "normalizeSearchEngineId",
    "asEnum",
    "asNumber",
    "wallpaperAttribution"
  ],
  "core feature markers"
);

assertIncludes(
  bootJs,
  ["tab.bootWallpaperPreview", "localStorage.getItem", "--boot-wallpaper"],
  "boot preview markers"
);

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  const prefix = check.ok ? "PASS" : "FAIL";
  console.log(`${prefix} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}

if (failed.length > 0) {
  process.exitCode = 1;
}
