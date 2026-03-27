import { browserApi } from "./browser-api.js";
import { BUILD_DEFAULTS } from "./config-defaults.js";

const STORAGE_KEY = "refhubPrototypeConfig";

export const DEFAULT_CONFIG = {
  apiBaseUrl: BUILD_DEFAULTS.apiBaseUrl || "",
  appBaseUrl: BUILD_DEFAULTS.appBaseUrl || "",
  apiKey: "",
  lastVaultId: "",
};

export async function loadConfig() {
  const result = await browserApi.storage.local.get(STORAGE_KEY);
  return {
    ...DEFAULT_CONFIG,
    ...(result?.[STORAGE_KEY] || {}),
  };
}

export async function saveConfig(nextConfig) {
  const config = {
    ...DEFAULT_CONFIG,
    ...nextConfig,
  };

  if (!BUILD_DEFAULTS.allowCustomUrls) {
    config.apiBaseUrl = DEFAULT_CONFIG.apiBaseUrl;
    config.appBaseUrl = DEFAULT_CONFIG.appBaseUrl;
  }

  await browserApi.storage.local.set({ [STORAGE_KEY]: config });
  return config;
}

export async function clearConfig() {
  await browserApi.storage.local.remove(STORAGE_KEY);
}
