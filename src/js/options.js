import { BUILD_DEFAULTS } from "./config-defaults.js";
import { clearConfig, loadConfig, saveConfig } from "./storage.js";

const form = document.querySelector("#settings-form");
const apiBaseUrl = document.querySelector("#api-base-url");
const appBaseUrl = document.querySelector("#app-base-url");
const apiKey = document.querySelector("#api-key");
const statusBanner = document.querySelector("#settings-status");
const keyPathLink = document.querySelector("#api-key-path-link");
const effectiveApiBaseUrl = document.querySelector("#effective-api-base-url");
const effectiveAppBaseUrl = document.querySelector("#effective-app-base-url");
const buildModePill = document.querySelector("#build-mode-pill");
const buildModeCopy = document.querySelector("#build-mode-copy");
const advancedEndpoints = document.querySelector("#advanced-endpoints");

document.querySelector("#clear-settings").addEventListener("click", async () => {
  await clearConfig();
  apiBaseUrl.value = BUILD_DEFAULTS.apiBaseUrl;
  appBaseUrl.value = BUILD_DEFAULTS.appBaseUrl;
  apiKey.value = "";
  renderBuildMode();
  renderConfigSummary({
    apiBaseUrl: BUILD_DEFAULTS.apiBaseUrl,
    appBaseUrl: BUILD_DEFAULTS.appBaseUrl,
  });
  renderKeyPath(BUILD_DEFAULTS.appBaseUrl);
  showStatus("settings_cleared", "success");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const config = await saveConfig({
    apiBaseUrl: BUILD_DEFAULTS.allowCustomUrls ? sanitizeUrl(apiBaseUrl.value) : BUILD_DEFAULTS.apiBaseUrl,
    appBaseUrl: BUILD_DEFAULTS.allowCustomUrls ? sanitizeUrl(appBaseUrl.value) : BUILD_DEFAULTS.appBaseUrl,
    apiKey: apiKey.value.trim(),
  });

  renderConfigSummary(config);
  renderKeyPath(config.appBaseUrl);
  showStatus("settings_saved • reopen_popup_to_capture", "success");
});

bootstrap().catch((error) => {
  showStatus(error.message, "error");
});

async function bootstrap() {
  renderBuildMode();
  const config = await loadConfig();
  apiBaseUrl.value = config.apiBaseUrl;
  appBaseUrl.value = config.appBaseUrl;
  apiKey.value = config.apiKey;
  renderConfigSummary(config);
  renderKeyPath(config.appBaseUrl);
}

function showStatus(message, variant) {
  statusBanner.textContent = message;
  statusBanner.className = `banner ${variant}`;
}

function sanitizeUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function renderBuildMode() {
  if (BUILD_DEFAULTS.allowCustomUrls) {
    buildModePill.textContent = "dev_override";
    buildModeCopy.textContent = "dev build exposes raw endpoints so you can point the extension at localhost or a self-hosted RefHub.";
    advancedEndpoints.classList.remove("hidden");
    return;
  }

  buildModePill.textContent = "production_locked";
  buildModeCopy.textContent = "release builds keep RefHub endpoints fixed. local or self-hosted targets are available through a dev override build.";
  advancedEndpoints.classList.add("hidden");
}

function renderConfigSummary(config) {
  effectiveApiBaseUrl.textContent = config.apiBaseUrl || "not_configured";
  effectiveAppBaseUrl.textContent = config.appBaseUrl || "not_configured";
}

function renderKeyPath(appUrl) {
  const base = sanitizeUrl(appUrl) || "https://refhub.io";
  keyPathLink.href = `${base}/profile-edit`;
}
