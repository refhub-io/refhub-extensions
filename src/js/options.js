import { clearConfig, loadConfig, saveConfig } from "./storage.js";

const form = document.querySelector("#settings-form");
const apiBaseUrl = document.querySelector("#api-base-url");
const appBaseUrl = document.querySelector("#app-base-url");
const apiKey = document.querySelector("#api-key");
const statusBanner = document.querySelector("#settings-status");
const keyPathLink = document.querySelector("#api-key-path-link");

document.querySelector("#clear-settings").addEventListener("click", async () => {
  await clearConfig();
  apiBaseUrl.value = "";
  appBaseUrl.value = "";
  apiKey.value = "";
  renderKeyPath("");
  showStatus("settings_cleared", "success");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  await saveConfig({
    apiBaseUrl: sanitizeUrl(apiBaseUrl.value),
    appBaseUrl: sanitizeUrl(appBaseUrl.value),
    apiKey: apiKey.value.trim(),
  });

  renderKeyPath(appBaseUrl.value);
  showStatus("settings_saved • reopen_popup_to_capture", "success");
});

bootstrap().catch((error) => {
  showStatus(error.message, "error");
});

async function bootstrap() {
  const config = await loadConfig();
  apiBaseUrl.value = config.apiBaseUrl;
  appBaseUrl.value = config.appBaseUrl;
  apiKey.value = config.apiKey;
  renderKeyPath(config.appBaseUrl);
}

function showStatus(message, variant) {
  statusBanner.textContent = message;
  statusBanner.className = `banner ${variant}`;
}

function sanitizeUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function renderKeyPath(appUrl) {
  const base = sanitizeUrl(appUrl) || "https://refhub.io";
  keyPathLink.href = `${base}/profile-edit`;
}
