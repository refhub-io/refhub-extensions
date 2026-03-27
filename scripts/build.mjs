import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");

const args = new Set(process.argv.slice(2));

if (args.has("--clean")) {
  await rm(distDir, { recursive: true, force: true });
  process.exit(0);
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

const chromeDir = path.join(distDir, "chrome");
const firefoxDir = path.join(distDir, "firefox");

await Promise.all([
  cp(srcDir, chromeDir, { recursive: true }),
  cp(srcDir, firefoxDir, { recursive: true }),
]);

await Promise.all([
  writeManifest(chromeDir, createChromeManifest()),
  writeManifest(firefoxDir, createFirefoxManifest()),
]);

await Promise.all([
  writeFile(path.join(chromeDir, "build-info.json"), JSON.stringify(buildInfo("chrome"), null, 2) + "\n"),
  writeFile(path.join(firefoxDir, "build-info.json"), JSON.stringify(buildInfo("firefox"), null, 2) + "\n"),
]);

console.log(`Built extension bundles in ${distDir}`);

function buildInfo(browser) {
  return {
    browser,
    builtAt: new Date().toISOString(),
    defaults: {
      refhubApiBaseUrl: process.env.REFHUB_API_BASE_URL || "",
      refhubAppBaseUrl: process.env.REFHUB_APP_BASE_URL || "",
    },
  };
}

async function writeManifest(targetDir, manifest) {
  const manifestPath = path.join(targetDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const optionsPath = path.join(targetDir, "js", "config-defaults.js");
  const template = await readFile(path.join(srcDir, "js", "config-defaults.template.js"), "utf8");
  const rendered = template
    .replace("__REFHUB_API_BASE_URL__", JSON.stringify(process.env.REFHUB_API_BASE_URL || ""))
    .replace("__REFHUB_APP_BASE_URL__", JSON.stringify(process.env.REFHUB_APP_BASE_URL || ""));
  await writeFile(optionsPath, rendered);
}

function createBaseManifest() {
  return {
    manifest_version: 3,
    name: "RefHub Capture Prototype",
    version: "0.1.0",
    description: "Capture the current tab and save a normalized item into a RefHub vault.",
    action: {
      default_title: "RefHub Capture",
      default_popup: "popup.html",
      default_icon: {
        16: "icons/refhub-16.png",
        32: "icons/refhub-32.png",
        48: "icons/refhub-48.png",
        128: "icons/refhub-128.png",
      },
    },
    icons: {
      16: "icons/refhub-16.png",
      32: "icons/refhub-32.png",
      48: "icons/refhub-48.png",
      128: "icons/refhub-128.png",
    },
    background: {
      service_worker: "js/background.js",
      type: "module",
    },
    options_page: "options.html",
    permissions: ["activeTab", "storage", "scripting"],
    host_permissions: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
    web_accessible_resources: [
      {
        resources: ["build-info.json"],
        matches: ["<all_urls>"],
      },
    ],
  };
}

function createChromeManifest() {
  return createBaseManifest();
}

function createFirefoxManifest() {
  return {
    ...createBaseManifest(),
    background: {
      scripts: ["js/background.js"],
      type: "module",
    },
    browser_specific_settings: {
      gecko: {
        id: "refhub-capture-prototype@refhub.io",
        strict_min_version: "128.0",
      },
    },
  };
}
