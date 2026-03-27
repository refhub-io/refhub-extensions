import { clearConfig, loadConfig, saveConfig } from "./storage.js";

const form = document.querySelector("#settings-form");
const apiBaseUrl = document.querySelector("#api-base-url");
const appBaseUrl = document.querySelector("#app-base-url");
const apiKey = document.querySelector("#api-key");
const statusBanner = document.querySelector("#settings-status");

document.querySelector("#clear-settings").addEventListener("click", async () => {
  await clearConfig();
  apiBaseUrl.value = "";
  appBaseUrl.value = "";
  apiKey.value = "";
  showStatus("Settings cleared.", "success");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  await saveConfig({
    apiBaseUrl: sanitizeUrl(apiBaseUrl.value),
    appBaseUrl: sanitizeUrl(appBaseUrl.value),
    apiKey: apiKey.value.trim(),
  });

  showStatus("Settings saved. Re-open the popup to capture and save.", "success");
});

bootstrap().catch((error) => {
  showStatus(error.message, "error");
});

async function bootstrap() {
  const config = await loadConfig();
  apiBaseUrl.value = config.apiBaseUrl;
  appBaseUrl.value = config.appBaseUrl;
  apiKey.value = config.apiKey;
}

function showStatus(message, variant) {
  statusBanner.textContent = message;
  statusBanner.className = `banner ${variant}`;
}

function sanitizeUrl(value) {
  return value.trim().replace(/\/+$/, "");
}
