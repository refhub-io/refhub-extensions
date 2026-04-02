import { browserApi, sendRuntimeMessage } from "./browser-api.js";
import { saveConfig } from "./storage.js";

const elements = {
  banner: document.querySelector("#message-banner"),
  setupCard: document.querySelector("#setup-card"),
  setupButton: document.querySelector("#setup-button"),
  setupAppLink: document.querySelector("#setup-app-link"),
  setupAppBase: document.querySelector("#setup-app-base"),
  setupApiBase: document.querySelector("#setup-api-base"),
  captureCard: document.querySelector("#capture-card"),
  captureLoading: document.querySelector("#capture-loading"),
  captureContent: document.querySelector("#capture-content"),
  confidenceBadge: document.querySelector("#confidence-badge"),
  captureTitle: document.querySelector("#capture-title"),
  captureSubtitle: document.querySelector("#capture-subtitle"),
  pageType: document.querySelector("#field-page-type"),
  doi: document.querySelector("#field-doi"),
  source: document.querySelector("#field-source"),
  url: document.querySelector("#field-url"),
  pdfUrl: document.querySelector("#field-pdf-url"),
  vaultCard: document.querySelector("#vault-card"),
  vaultSelect: document.querySelector("#vault-select"),
  refreshVaults: document.querySelector("#refresh-vaults"),
  driveCard: document.querySelector("#drive-card"),
  drivePill: document.querySelector("#drive-pill"),
  driveCopy: document.querySelector("#drive-copy"),
  saveButton: document.querySelector("#save-button"),
  openOptions: document.querySelector("#open-options"),
  quickStatus: document.querySelector("#quick-status"),
  vaultHint: document.querySelector("#vault-hint"),
};

let currentCapture = null;
let writableVaults = [];
let currentConfig = null;
let currentDriveStatus = null;

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
  elements.captureLoading.textContent = "// failed_to_initialize_popup";
});

async function bootstrap() {
  const state = await sendRuntimeMessage({ type: "refhub:get-popup-state" });
  currentConfig = state.config;

  if (!state.config.apiBaseUrl || !state.config.apiKey) {
    elements.setupCard.classList.remove("hidden");
    renderSetupState(state.config);
    showBanner("finish setup before saving capture.", "error");
    return;
  }

  elements.captureCard.classList.remove("hidden");
  elements.vaultCard.classList.remove("hidden");
  elements.driveCard.classList.remove("hidden");
  renderSetupState(state.config);
  renderQuickStatus(state.config);

  await Promise.all([extractCurrentTab(), loadVaults(false), loadGoogleDriveStatus(false)]);
}

async function extractCurrentTab() {
  elements.captureLoading.classList.remove("hidden");
  elements.captureContent.classList.add("hidden");
  elements.saveButton.disabled = true;

  try {
    currentCapture = await sendRuntimeMessage({ type: "refhub:extract-current-tab" });
    renderCapture(currentCapture);
    showBanner(currentCapture.saveable ? "metadata extracted • ready_to_save" : currentCapture.blockReason, currentCapture.saveable ? "success" : "error");
  } catch (error) {
    currentCapture = null;
    showBanner(error.message, "error");
    elements.captureLoading.textContent = "// could_not_extract_tab_metadata";
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

async function loadGoogleDriveStatus(forceRefresh) {
  try {
    currentDriveStatus = await sendRuntimeMessage({ type: "refhub:get-google-drive-status", forceRefresh });
    renderGoogleDriveStatus(currentDriveStatus);
  } catch (error) {
    currentDriveStatus = {
      linked: false,
      folder_status: "unlinked",
      folder_name: null,
      folder_id: null,
    };
    renderGoogleDriveStatus(currentDriveStatus, error.message);
  }
}

function renderCapture(capture) {
  elements.captureLoading.classList.add("hidden");
  elements.captureContent.classList.remove("hidden");
  elements.confidenceBadge.textContent = `${Math.round(capture.confidence * 100)}% confidence`;
  elements.captureTitle.textContent = capture.item.title || "untitled_page";
  elements.captureSubtitle.textContent = buildSubtitle(capture.item);
  elements.pageType.textContent = capture.pageType;
  elements.doi.textContent = capture.item.doi || "not_found";
  elements.source.textContent = capture.item.journal || capture.hostname || "unknown_source";
  elements.url.textContent = capture.item.url || "-";
  elements.pdfUrl.textContent = capture.item.pdf_url || "not_detected";
  syncSaveButton();
}

function buildSubtitle(item) {
  const left = item.authors?.length ? item.authors.join(", ") : "no_authors_found";
  const right = [item.year, item.journal].filter(Boolean).join(" · ");
  return right ? `${left} · ${right}` : left;
}

function renderVaults(vaults, lastVaultId) {
  if (!vaults.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "no_writable_vaults_found";
    elements.vaultSelect.append(option);
    elements.vaultSelect.disabled = true;
    elements.vaultHint.textContent = "// current_key_cannot_write_any_accessible_vault";
    showBanner("no writable vaults available for this key.", "error");
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const vault of vaults) {
    const option = document.createElement("option");
    option.value = vault.id;
    option.textContent = `${vault.name} • ${vault.permission}`;
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
  elements.vaultHint.textContent = "// public vaults open at /public/:slug • private/shared vaults open at /vault/:id";
  syncSaveButton();
}

async function saveCapture() {
  if (!currentCapture?.saveable) {
    return;
  }

  const vaultId = elements.vaultSelect.value;
  if (!vaultId) {
    showBanner("choose a writable vault first.", "error");
    return;
  }

  elements.saveButton.disabled = true;
  elements.saveButton.textContent = "saving...";

  try {
    const response = await sendRuntimeMessage({
      type: "refhub:save-item",
      payload: {
        vaultId,
        item: currentCapture.item,
      },
    });

    const vault = writableVaults.find((entry) => entry.id === vaultId);
    const vaultLabel = vault ? `saved_to ${vault.name}` : "saved_to_refhub";
    const pdfStorage = response.response?.data?.[0]?.pdf_storage;
    let bannerText = vaultLabel;
    if (pdfStorage?.stored) {
      bannerText += " • pdf_sent_to_drive";
    } else if (pdfStorage?.attempted && pdfStorage?.message) {
      bannerText += ` • drive_failed: ${pdfStorage.message}`;
    }
    showBanner(bannerText, pdfStorage?.attempted && !pdfStorage?.stored ? "error" : "success");
    if (response.openUrl) {
      await browserApi.tabs.create({ url: response.openUrl });
    }
  } catch (error) {
    showBanner(error.message, "error");
  } finally {
    elements.saveButton.textContent = "save_to_refhub";
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

function renderQuickStatus(config) {
  const target = config.appBaseUrl || "https://refhub.io";
  const driveFlag = currentDriveStatus?.linked ? "drive_pdf_storage_on" : "drive_pdf_storage_off";
  elements.quickStatus.textContent = `api_ready • ${driveFlag} • open_target ${target}`;
}

function renderSetupState(config) {
  const target = config.appBaseUrl || "https://refhub.io";
  elements.setupAppLink.href = `${target}/profile-edit`;
  elements.setupAppBase.textContent = target;
  elements.setupApiBase.textContent = config.apiBaseUrl || "not_configured";
}

async function openOptions() {
  await browserApi.runtime.openOptionsPage();
}

function renderGoogleDriveStatus(status, errorMessage = "") {
  const linked = Boolean(status?.linked);
  elements.drivePill.textContent = linked ? "linked" : "inactive";
  elements.driveCopy.textContent = linked
    ? `pdf saves with a discovered pdf_url will be routed through RefHub into Drive folder ${status.folder_name || "refhub"}.`
    : errorMessage || "google drive pdf storage is not linked for this RefHub account. saves will keep the source pdf_url only.";
  renderQuickStatus(currentConfig || { appBaseUrl: "https://refhub.io" });
}
