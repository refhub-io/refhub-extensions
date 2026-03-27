import { browserApi, sendRuntimeMessage } from "./browser-api.js";
import { saveConfig } from "./storage.js";

const elements = {
  banner: document.querySelector("#message-banner"),
  setupCard: document.querySelector("#setup-card"),
  setupButton: document.querySelector("#setup-button"),
  captureCard: document.querySelector("#capture-card"),
  captureLoading: document.querySelector("#capture-loading"),
  captureContent: document.querySelector("#capture-content"),
  confidenceBadge: document.querySelector("#confidence-badge"),
  captureTitle: document.querySelector("#capture-title"),
  captureSubtitle: document.querySelector("#capture-subtitle"),
  rawPreview: document.querySelector("#raw-preview"),
  pageType: document.querySelector("#field-page-type"),
  doi: document.querySelector("#field-doi"),
  source: document.querySelector("#field-source"),
  url: document.querySelector("#field-url"),
  vaultCard: document.querySelector("#vault-card"),
  vaultSelect: document.querySelector("#vault-select"),
  refreshVaults: document.querySelector("#refresh-vaults"),
  saveButton: document.querySelector("#save-button"),
  openOptions: document.querySelector("#open-options"),
};

let currentCapture = null;
let writableVaults = [];
let currentConfig = null;

document.querySelector("#setup-button").addEventListener("click", openOptions);
elements.openOptions.addEventListener("click", openOptions);
elements.refreshVaults.addEventListener("click", () => loadVaults(true));
elements.saveButton.addEventListener("click", saveCapture);
elements.vaultSelect.addEventListener("change", async () => {
  syncSaveButton();
  if (!currentConfig) {
    return;
  }
  currentConfig = await saveConfig({
    ...currentConfig,
    lastVaultId: elements.vaultSelect.value,
  });
});

bootstrap().catch((error) => {
  showBanner(error.message, "error");
  elements.captureCard.classList.remove("hidden");
  elements.captureLoading.textContent = "Failed to initialize popup.";
});

async function bootstrap() {
  const state = await sendRuntimeMessage({ type: "refhub:get-popup-state" });
  currentConfig = state.config;

  if (!state.config.apiBaseUrl || !state.config.apiKey) {
    elements.setupCard.classList.remove("hidden");
    showBanner("Settings are required before capture can be saved.", "error");
    return;
  }

  elements.captureCard.classList.remove("hidden");
  elements.vaultCard.classList.remove("hidden");

  await Promise.all([extractCurrentTab(), loadVaults(false)]);
}

async function extractCurrentTab() {
  elements.captureLoading.classList.remove("hidden");
  elements.captureContent.classList.add("hidden");
  elements.saveButton.disabled = true;

  try {
    currentCapture = await sendRuntimeMessage({ type: "refhub:extract-current-tab" });
    renderCapture(currentCapture);
    showBanner(currentCapture.saveable ? "Metadata extracted and ready to save." : currentCapture.blockReason, currentCapture.saveable ? "success" : "error");
  } catch (error) {
    currentCapture = null;
    showBanner(error.message, "error");
    elements.captureLoading.textContent = "Could not extract metadata from this tab.";
  }
}

async function loadVaults(forceRefresh) {
  elements.vaultSelect.disabled = true;
  elements.vaultSelect.innerHTML = "";

  try {
    const response = await sendRuntimeMessage({ type: "refhub:list-vaults", forceRefresh });
    writableVaults = response.vaults;
    currentConfig = response.config;
    renderVaults(response.vaults, response.config.lastVaultId);
  } catch (error) {
    writableVaults = [];
    showBanner(error.message, "error");
  } finally {
    syncSaveButton();
  }
}

function renderCapture(capture) {
  elements.captureLoading.classList.add("hidden");
  elements.captureContent.classList.remove("hidden");
  elements.confidenceBadge.textContent = `${Math.round(capture.confidence * 100)}% confidence`;
  elements.captureTitle.textContent = capture.item.title || "Untitled page";
  elements.captureSubtitle.textContent = buildSubtitle(capture.item);
  elements.pageType.textContent = capture.pageType;
  elements.doi.textContent = capture.item.doi || "Not found";
  elements.source.textContent = capture.item.journal || capture.hostname || "Unknown";
  elements.url.textContent = capture.item.url || "-";
  elements.rawPreview.textContent = JSON.stringify(
    {
      title: capture.item.title,
      authors: capture.item.authors,
      year: capture.item.year,
      journal: capture.item.journal,
      abstract: capture.item.abstract,
      publication_type: capture.item.publication_type,
      metadata_sources: capture.metadataSources,
    },
    null,
    2,
  );
  syncSaveButton();
}

function buildSubtitle(item) {
  const left = item.authors?.length ? item.authors.join(", ") : "No authors found";
  const right = [item.year, item.journal].filter(Boolean).join(" · ");
  return right ? `${left} · ${right}` : left;
}

function renderVaults(vaults, lastVaultId) {
  if (!vaults.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No writable vaults found";
    elements.vaultSelect.append(option);
    elements.vaultSelect.disabled = true;
    showBanner("No writable vaults are available for this API key.", "error");
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const vault of vaults) {
    const option = document.createElement("option");
    option.value = vault.id;
    option.textContent = `${vault.name} (${vault.permission})`;
    if (vault.id === lastVaultId) {
      option.selected = true;
    }
    fragment.append(option);
  }

  if (!lastVaultId) {
    fragment.firstChild.selected = true;
  }

  elements.vaultSelect.replaceChildren(fragment);
  elements.vaultSelect.disabled = false;
  syncSaveButton();
}

async function saveCapture() {
  if (!currentCapture?.saveable) {
    return;
  }

  const vaultId = elements.vaultSelect.value;
  if (!vaultId) {
    showBanner("Choose a writable vault first.", "error");
    return;
  }

  elements.saveButton.disabled = true;
  elements.saveButton.textContent = "Saving…";

  try {
    const response = await sendRuntimeMessage({
      type: "refhub:save-item",
      payload: {
        vaultId,
        item: currentCapture.item,
      },
    });

    const vault = writableVaults.find((entry) => entry.id === vaultId);
    const vaultLabel = vault ? `Saved to ${vault.name}.` : "Saved to RefHub.";
    showBanner(vaultLabel, "success");
    if (response.openUrl) {
      await browserApi.tabs.create({ url: response.openUrl });
    }
  } catch (error) {
    showBanner(error.message, "error");
  } finally {
    elements.saveButton.textContent = "Save to RefHub";
    syncSaveButton();
  }
}

function syncSaveButton() {
  const canSave = Boolean(currentCapture?.saveable && writableVaults.length && elements.vaultSelect.value);
  elements.saveButton.disabled = !canSave;
}

function showBanner(message, variant) {
  elements.banner.textContent = message;
  elements.banner.className = `banner ${variant}`;
}

async function openOptions() {
  await browserApi.runtime.openOptionsPage();
}
