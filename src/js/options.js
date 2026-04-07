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
const saveButton = document.querySelector("#save-button");
const toggleApiKey = document.querySelector("#toggle-api-key");
const apiUrlTile = document.querySelector("#api-url-tile");
const appUrlTile = document.querySelector("#app-url-tile");
const apiUrlTileLabel = document.querySelector("#api-url-tile-label");
const appUrlTileLabel = document.querySelector("#app-url-tile-label");

// ── toggle API key visibility ─────────────────────────────────────────────

toggleApiKey.addEventListener("click", () => {
  const isHidden = apiKey.type === "password";
  apiKey.type = isHidden ? "text" : "password";
  toggleApiKey.textContent = isHidden ? "hide" : "show";
});

// ── clear ─────────────────────────────────────────────────────────────────

document.querySelector("#clear-settings").addEventListener("click", async () => {
  await clearConfig();
  apiBaseUrl.value = BUILD_DEFAULTS.apiBaseUrl;
  appBaseUrl.value = BUILD_DEFAULTS.appBaseUrl;
  apiKey.value = "";
  apiKey.type = "password";
  toggleApiKey.textContent = "show";
  renderBuildMode();
  renderConfigSummary({
    apiBaseUrl: BUILD_DEFAULTS.apiBaseUrl,
    appBaseUrl: BUILD_DEFAULTS.appBaseUrl,
  });
  renderKeyPath(BUILD_DEFAULTS.appBaseUrl);
  showStatus("settings_cleared", "success");
});

// ── save ──────────────────────────────────────────────────────────────────

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const config = await saveConfig({
    apiBaseUrl: BUILD_DEFAULTS.allowCustomUrls ? sanitizeUrl(apiBaseUrl.value) : BUILD_DEFAULTS.apiBaseUrl,
    appBaseUrl: BUILD_DEFAULTS.allowCustomUrls ? sanitizeUrl(appBaseUrl.value) : BUILD_DEFAULTS.appBaseUrl,
    apiKey: apiKey.value.trim(),
  });

  renderConfigSummary(config);
  renderKeyPath(config.appBaseUrl);
  showSavedConfirmation();
  showStatus("settings_saved • reopen_popup_to_capture", "success");
});

bootstrap().catch((error) => {
  showStatus(error.message, "error");
});

// ── bootstrap ─────────────────────────────────────────────────────────────

async function bootstrap() {
  renderBuildMode();
  const config = await loadConfig();
  if (apiBaseUrl) apiBaseUrl.value = config.apiBaseUrl;
  if (appBaseUrl) appBaseUrl.value = config.appBaseUrl;
  apiKey.value = config.apiKey;
  renderConfigSummary(config);
  renderKeyPath(config.appBaseUrl);
}

// ── helpers ───────────────────────────────────────────────────────────────

let savedTimer = null;

function showSavedConfirmation() {
  if (savedTimer) clearTimeout(savedTimer);
  saveButton.textContent = "saved_✓";
  saveButton.classList.add("saved");
  saveButton.disabled = true;
  savedTimer = setTimeout(() => {
    saveButton.textContent = "save_settings";
    saveButton.classList.remove("saved");
    saveButton.disabled = false;
    savedTimer = null;
  }, 2000);
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
    buildModeCopy.textContent = "dev build exposes raw endpoints so you can point the extension at localhost or a self-hosted refhub.";
    advancedEndpoints.classList.remove("hidden");
    // Remove lock indicators when in dev mode
    apiUrlTile.classList.remove("is-locked");
    appUrlTile.classList.remove("is-locked");
    apiUrlTileLabel.textContent = "refhub_api_base_url";
    appUrlTileLabel.textContent = "refhub_app_url";
    return;
  }

  buildModePill.textContent = "production_locked";
  buildModeCopy.textContent = "release builds keep refhub endpoints fixed. local or self-hosted targets are available through a dev override build.";
  advancedEndpoints.classList.add("hidden");
  // Lock indicators on the URL tiles
  apiUrlTile.classList.add("is-locked");
  appUrlTile.classList.add("is-locked");
  apiUrlTileLabel.textContent = "🔒 refhub_api_base_url";
  appUrlTileLabel.textContent = "🔒 refhub_app_url";
}

function renderConfigSummary(config) {
  effectiveApiBaseUrl.textContent = config.apiBaseUrl || "not_configured";
  effectiveAppBaseUrl.textContent = config.appBaseUrl || "not_configured";
}

function renderKeyPath(appUrl) {
  const base = sanitizeUrl(appUrl) || "https://refhub.io";
  keyPathLink.href = `${base}/profile-edit`;
}
