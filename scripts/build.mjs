import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");
const PRODUCTION_API_BASE_URL = "https://refhub-api.netlify.app";
const PRODUCTION_APP_BASE_URL = "https://refhub.io";
const buildDefaults = {
  apiBaseUrl: process.env.REFHUB_API_BASE_URL || PRODUCTION_API_BASE_URL,
  appBaseUrl: process.env.REFHUB_APP_BASE_URL || PRODUCTION_APP_BASE_URL,
  allowCustomUrls: process.env.REFHUB_ALLOW_CUSTOM_URLS === "1",
};

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
      refhubApiBaseUrl: buildDefaults.apiBaseUrl,
      refhubAppBaseUrl: buildDefaults.appBaseUrl,
      refhubAllowCustomUrls: buildDefaults.allowCustomUrls,
    },
  };
}

async function writeManifest(targetDir, manifest) {
  const manifestPath = path.join(targetDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const optionsPath = path.join(targetDir, "js", "config-defaults.js");
  const template = await readFile(path.join(srcDir, "js", "config-defaults.template.js"), "utf8");
  const rendered = template
    .replace("__REFHUB_API_BASE_URL__", JSON.stringify(buildDefaults.apiBaseUrl))
    .replace("__REFHUB_APP_BASE_URL__", JSON.stringify(buildDefaults.appBaseUrl))
    .replace("__REFHUB_ALLOW_CUSTOM_URLS__", JSON.stringify(buildDefaults.allowCustomUrls));
  await writeFile(optionsPath, rendered);
}

function createBaseManifest() {
  return {
    manifest_version: 3,
    name: "refhub ext",
    version: "0.1.0",
    description: "capture and save to your refhub vault.",
    action: {
      default_title: "refhub Capture",
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
    permissions: ["activeTab", "storage", "scripting", "cookies"],
    host_permissions: buildHostPermissions(),
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
        strict_min_version: "140.0",
        data_collection_permissions: {
          required: ["none"],
          optional: [],
        },
      },
      gecko_android: {
        strict_min_version: "142.0",
        data_collection_permissions: {
          required: ["none"],
          optional: [],
        },
      },
    },
  };
}

function buildHostPermissions() {
  return ["https://*/*", "http://*/*"];
}
