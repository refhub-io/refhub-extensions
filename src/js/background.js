import { browserApi } from "./browser-api.js";
import { loadConfig, saveConfig } from "./storage.js";
import { findTranslator, isPdfWrapper, isPdfBinary, resolveLandingUrl, resolvePdfDownloadUrl } from "./translators/index.js";

const runtimeApi = globalThis.browser ?? globalThis.chrome;
const MAX_FORWARDED_COOKIE_BYTES = 12 * 1024;

const vaultCache = {
  data: null,
  fetchedAt: 0,
};
const driveStatusCache = {
  data: null,
  fetchedAt: 0,
};

const CACHE_TTL_MS = 60_000;

runtimeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ __error: error.message }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "refhub:get-popup-state":
      return { config: await loadConfig() };
    case "refhub:list-vaults":
      return listVaults(Boolean(message.forceRefresh));
    case "refhub:extract-current-tab":
      return extractCurrentTab();
    case "refhub:get-google-drive-status":
      return getGoogleDriveStatus(Boolean(message.forceRefresh));
    case "refhub:save-item":
      return saveItem(message.payload);
    default:
      throw new Error("Unknown extension message.");
  }
}

async function listVaults(forceRefresh) {
  const config = await loadConfig();
  assertConfigured(config);

  if (!forceRefresh && vaultCache.data && Date.now() - vaultCache.fetchedAt < CACHE_TTL_MS) {
    return {
      config,
      vaults: pickWritableVaults(vaultCache.data),
    };
  }

  const response = await apiRequest(config, "/api/v1/vaults", { method: "GET" });
  const vaults = Array.isArray(response.data) ? response.data : [];
  vaultCache.data = vaults;
  vaultCache.fetchedAt = Date.now();

  return {
    config,
    vaults: pickWritableVaults(vaults),
  };
}

async function extractCurrentTab() {
  const [tab] = await browserApi.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab?.id || !tab.url) {
    throw new Error("No active tab is available.");
  }

  if (!/^https?:/i.test(tab.url)) {
    throw new Error("Only http(s) pages are supported by this prototype.");
  }

  // Native PDF viewer tabs have no accessible DOM — scripting.executeScript would
  // fail or return nothing useful. Use the tab URL itself as the pdf_url.
  if (isPdfWrapper(tab.url)) {
    const [{ result: raw }] = await browserApi.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageMetadata,
    });

    // Publisher-specific enrichment for wrapper pages (e.g. ACM two-step metadata fetch).
    const translator = findTranslator(tab.url);
    if (translator.enrichWrapper) {
      await translator.enrichWrapper(raw, tab, browserApi);
    }

    const normalized = normalizeCapture(raw);
    normalized.sourceTabId = tab.id;
    normalized.sourceTabUrl = tab.url;
    return enrichPdfWrapperCapture(await loadConfig(), normalized, tab.url);
  }

  if (isPdfBinary(tab.url)) {
    return enrichPdfTabCapture(await loadConfig(), normalizePdfTabCapture(tab));
  }

  const [{ result: raw }] = await browserApi.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageMetadata,
  });

  // Publisher-specific enrichment for landing pages (e.g. IEEE xplGlobal, Elsevier DOM authors).
  const landingTranslator = findTranslator(tab.url);
  if (landingTranslator.enrichCapture) {
    await landingTranslator.enrichCapture(raw, tab, browserApi);
  }

  const normalized = normalizeCapture(raw);
  normalized.sourceTabId = tab.id;
  normalized.sourceTabUrl = tab.url;
  if (!normalized.saveable && normalized.pageType === "unsupported") {
    normalized.blockReason = normalized.blockReason || "This page type is not supported yet.";
  }
  return normalized;
}

function normalizePdfTabCapture(tab) {
  const url = sanitizeUrl(tab.url);
  const title = tab.title || url.split("/").pop().replace(/\.pdf$/i, "") || "Untitled PDF";
  const doi = normalizeDoi(detectDoi(url));
  const hostname = getHostname(url);

  const item = compactObject({
    title,
    url,
    doi,
    pdf_url: url,
    publication_type: "article",
  });

  return {
    item,
    hostname,
    pageType: "pdf-direct",
    confidence: 0.4,
    metadataSources: ["url"],
    saveable: true,
    blockReason: "",
    sourceTabId: tab.id,
    sourceTabUrl: url,
    sourcePageUrl: url,
  };
}

async function enrichPdfTabCapture(config, capture) {
  const pdfUrl = capture.item?.pdf_url || "";
  const landingUrl = resolveLandingUrl(pdfUrl);

  // For publishers like arXiv (/abs/{id}) and HAL (/hal-{id}) the landing page
  // has rich citation_* meta tags.  Fetch it to get proper title, authors, DOI
  // instead of relying solely on PDF text extraction.
  let nextCapture = capture;
  if (landingUrl && landingUrl !== pdfUrl) {
    nextCapture = { ...nextCapture, sourcePageUrl: landingUrl };
    const pageMetadata = await fetchPageMetadataFromUrl(landingUrl).catch(() => null);
    nextCapture = mergeCaptureWithPageMetadata(nextCapture, pageMetadata, landingUrl);
  }

  const pdfMetadata = await fetchPdfMetadata(config, pdfUrl, nextCapture.sourcePageUrl || pdfUrl);
  return mergeCaptureWithPdfMetadata(nextCapture, pdfMetadata);
}

async function enrichPdfWrapperCapture(config, capture, wrapperUrl) {
  // Resolve URLs via the publisher translator for this domain.
  const rawPdfUrl = firstNonEmpty(capture.item?.pdf_url, wrapperUrl);
  // The download URL is what the server (or browser) actually fetches — for
  // publishers like Wiley this converts /epdf/ → /pdfdirect/ so the server
  // receives a real PDF binary instead of an HTML viewer page.
  const pdfDownloadUrl = resolvePdfDownloadUrl(rawPdfUrl);
  // Landing URL: the article abstract/full-text page used for metadata scraping.
  const landingUrl = firstNonEmpty(resolveLandingUrl(rawPdfUrl), resolveLandingUrl(wrapperUrl));

  let nextCapture = {
    ...capture,
    pageType: "pdf-wrapper",
    item: compactObject({
      ...capture.item,
      url: firstNonEmpty(landingUrl, capture.item?.url, wrapperUrl),
      pdf_url: pdfDownloadUrl,
      publication_type: "article",
    }),
    sourcePageUrl: firstNonEmpty(landingUrl, capture.sourcePageUrl, wrapperUrl),
  };

  if (landingUrl) {
    // Prefer injecting into the open tab: same-origin fetch → no CORS restriction.
    // Fall back to a background fetch for cases where scripting is unavailable.
    const pageMetadata = capture.sourceTabId
      ? await fetchPageMetadataFromTabContext(capture.sourceTabId, landingUrl).catch(() => null)
          || await fetchPageMetadataFromUrl(landingUrl).catch(() => null)
      : await fetchPageMetadataFromUrl(landingUrl).catch(() => null);
    nextCapture = mergeCaptureWithPageMetadata(nextCapture, pageMetadata, landingUrl);
  }

  const pdfMetadata = await fetchPdfMetadata(config, pdfDownloadUrl, firstNonEmpty(landingUrl, wrapperUrl));
  return mergeCaptureWithPdfMetadata(nextCapture, pdfMetadata);
}

async function fetchPageMetadataFromTabContext(tabId, url) {
  const [{ result }] = await browserApi.scripting.executeScript({
    target: { tabId },
    args: [url],
    world: "MAIN",
    func: fetchHtmlFromPageContext,
  });
  if (!result?.ok || !result.html) {
    return null;
  }
  return extractMetadataFromHtml(result.html, result.finalUrl || url);
}

// Runs inside the page context — must be self-contained (no closure over background scope).
function fetchHtmlFromPageContext(targetUrl) {
  return fetch(targetUrl, {
    credentials: "include",
    redirect: "follow",
    headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
  })
    .then((r) => {
      if (!r.ok) return { ok: false };
      return r.text().then((html) => {
        // Cloudflare managed-challenge pages sometimes return HTTP 200 with a
        // JS-challenge body.  Detect them and treat as a fetch failure so we
        // don't try to parse the challenge HTML as article metadata.
        const isCfChallenge =
          /<title>Just a moment\.\.\.<\/title>/i.test(html) ||
          /cf-browser-verification|cf_chl_opt/i.test(html);
        if (isCfChallenge) return { ok: false, message: "cf_challenge" };
        return { ok: true, html, finalUrl: r.url };
      });
    })
    .catch((err) => ({ ok: false, message: err.message }));
}


async function fetchPageMetadataFromUrl(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!/html|xml/i.test(contentType)) {
      return null;
    }

    const html = await response.text();
    return extractMetadataFromHtml(html, response.url || url);
  } catch {
    return null;
  }
}

function isSessionBoundPdfUrl(url) {
  return /[?&]hmac=/i.test(url) || /[?&]X-Amz-Signature=/i.test(url);
}

async function fetchPdfMetadata(config, pdfUrl, referer = "") {
  if (!pdfUrl) {
    return null;
  }

  // Session-bound URLs cannot be fetched server-side — skip the round-trip.
  // hmac= : ACM pdfdirect, Wiley pdfdirect (session+IP-bound)
  // X-Amz-Signature= : AWS presigned S3 URLs (e.g. ScienceDirect assets, short TTL)
  if (isSessionBoundPdfUrl(pdfUrl)) {
    return null;
  }

  try {
    const response = await apiRequest(config, "/api/v1/pdf-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_url: pdfUrl,
        cookie_header: (await buildCookieHeader(pdfUrl)) || undefined,
        referer: referer || undefined,
      }),
    });
    return response?.data || null;
  } catch {
    return null;
  }
}

function mergeCaptureWithPageMetadata(capture, pageMetadata, landingUrl) {
  if (!pageMetadata) {
    return capture;
  }

  return {
    ...capture,
    confidence: Math.max(capture.confidence || 0, 0.7),
    metadataSources: uniqueStrings([...(capture.metadataSources || []), "landing_page"]),
    item: compactObject({
      title: firstNonEmpty(pageMetadata.title, capture.item?.title),
      authors: uniqueStrings([...(pageMetadata.authors || []), ...(capture.item?.authors || [])]),
      year: pageMetadata.year || capture.item?.year,
      journal: firstNonEmpty(pageMetadata.journal, capture.item?.journal),
      doi: firstNonEmpty(pageMetadata.doi, capture.item?.doi),
      url: firstNonEmpty(landingUrl, pageMetadata.url, capture.item?.url),
      abstract: firstNonEmpty(pageMetadata.abstract, capture.item?.abstract),
      publication_type: firstNonEmpty(capture.item?.publication_type, "article"),
      pdf_url: firstNonEmpty(capture.item?.pdf_url, pageMetadata.pdf_url),
    }),
  };
}

function mergeCaptureWithPdfMetadata(capture, pdfMetadata) {
  if (!pdfMetadata) {
    return capture;
  }

  const doi = normalizeDoi(firstNonEmpty(pdfMetadata.doi, capture.item?.doi));
  const title = prefersPdfTitle(capture.item?.title) ? firstNonEmpty(pdfMetadata.title, capture.item?.title) : firstNonEmpty(capture.item?.title, pdfMetadata.title);
  const authors = uniqueStrings([...(pdfMetadata.authors?.length ? pdfMetadata.authors : []), ...(capture.item?.authors || [])]);
  const year = pdfMetadata.year || capture.item?.year;
  const journal = firstNonEmpty(pdfMetadata.journal, capture.item?.journal);
  return {
    ...capture,
    confidence: Math.max(capture.confidence || 0, doi ? 0.72 : capture.confidence || 0),
    metadataSources: uniqueStrings([...(capture.metadataSources || []), "pdf_first_page"]),
    item: compactObject({
      title,
      authors,
      year,
      journal,
      doi,
      url: capture.item?.url,
      abstract: capture.item?.abstract,
      publication_type: capture.item?.publication_type,
      pdf_url: capture.item?.pdf_url,
    }),
  };
}

function prefersPdfTitle(title) {
  const value = String(title || "").trim();
  return !value || /^(untitled pdf|ieee xplore full-text pdf:?|full[-\s]?text pdf:?|pdf)$/i.test(value);
}

async function saveItem(payload) {
  const config = await loadConfig();
  assertConfigured(config);

  const { vaultId, item, captureContext } = payload || {};
  if (!vaultId) {
    throw new Error("A target vault is required.");
  }
  if (!item?.title) {
    throw new Error("The captured item is missing a title.");
  }

  const response = await apiRequest(config, `/api/v1/vaults/${encodeURIComponent(vaultId)}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [item] }),
  });

  await saveConfig({ ...config, lastVaultId: vaultId });

  // After the item is saved, attempt to fetch the PDF client-side (with browser cookies
  // for institutional access) and upload it to the user's Drive folder.
  const driveStatus = await getGoogleDriveStatus(true).catch(() => ({ linked: false }));
  let pdfStorage = null;

  const savedItemId = response.data?.[0]?.id;
  const isPdfPage = ["pdf-direct", "pdf-wrapper"].includes(captureContext?.pageType);
  const pdfDownloadUrl = resolvePdfDownloadUrl(item.pdf_url);
  if (item.pdf_url && driveStatus.linked && savedItemId && isPdfPage) {
    pdfStorage = await fetchAndUploadPdf(config, vaultId, savedItemId, pdfDownloadUrl, captureContext);
  }

  const responseWithPdf = {
    ...response,
    data: response.data?.map((entry, i) => (i === 0 ? { ...entry, pdf_storage: pdfStorage } : entry)),
  };

  return {
    response: responseWithPdf,
    openUrl: buildVaultUrl(config, vaultId),
    driveStatus,
  };
}

// PDF upload: backend source-URL approach for public/institutional PDFs;
// browser-fetch + direct Drive upload for session-bound CDN URLs (e.g.
// ScienceDirect S3 presigned URLs protected by Cloudflare IP checks).
async function fetchAndUploadPdf(config, vaultId, vaultPublicationId, pdfUrl, captureContext) {
  if (isSessionBoundPdfUrl(pdfUrl)) {
    return uploadPdfViaBrowserFetch(config, vaultId, vaultPublicationId, pdfUrl);
  }
  return uploadPdfBySourceUrl(config, vaultId, vaultPublicationId, pdfUrl, captureContext);
}

// For Cloudflare-protected / presigned URLs the backend can't fetch from a
// different IP.  Instead: browser fetches the bytes (right IP + cf_clearance),
// backend creates a Drive resumable upload session, browser PUTs directly to
// Google Drive, then notifies backend to record the upload.
async function uploadPdfViaBrowserFetch(config, vaultId, vaultPublicationId, pdfUrl) {
  // 1. Fetch the PDF bytes in the browser (user's IP + cookies).
  let pdfResponse;
  try {
    pdfResponse = await fetch(pdfUrl, {
      credentials: "include",
      redirect: "follow",
      headers: { accept: "application/pdf,application/octet-stream,*/*;q=0.8" },
    });
  } catch (e) {
    return { attempted: true, stored: false, message: `Browser fetch error: ${e.message}` };
  }
  if (!pdfResponse.ok) {
    return { attempted: true, stored: false, message: `Browser fetch failed (${pdfResponse.status}).` };
  }
  const pdfBytes = await pdfResponse.arrayBuffer();

  // 2. Ask the backend to create a Drive resumable upload session.
  const base = `${config.apiBaseUrl}/api/v1/vaults/${encodeURIComponent(vaultId)}/items/${encodeURIComponent(vaultPublicationId)}/pdf`;
  const sessionResp = await fetch(`${base}/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!sessionResp.ok) {
    const sessionErr = await sessionResp.json().catch(() => ({}));
    return { attempted: true, stored: false, message: sessionErr?.error?.message || "Drive session creation failed." };
  }
  const { data: session } = await sessionResp.json();

  // 3. PUT bytes directly to Google Drive (no Netlify in the path → no size limit).
  const driveResp = await fetch(session.upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdfBytes.byteLength),
    },
    body: pdfBytes,
  });
  if (!driveResp.ok) {
    return { attempted: true, stored: false, message: `Drive upload failed (${driveResp.status}).` };
  }
  const driveFile = await driveResp.json().catch(() => ({}));

  // 4. Notify backend to record the upload in the database.
  await fetch(`${base}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      file_id: driveFile.id,
      web_view_link: driveFile.webViewLink || driveFile.webContentLink || null,
      source_url: pdfUrl,
    }),
  }).catch(() => { /* record failure is non-fatal */ });

  return {
    attempted: true,
    stored: true,
    source_url: pdfUrl,
    fetch_strategy: "browser-direct",
    pdfUrl: driveFile.webViewLink || driveFile.webContentLink || null,
  };
}

async function uploadPdfBySourceUrl(config, vaultId, vaultPublicationId, pdfUrl, captureContext) {
  const cookieHeader = await buildCookieHeader(pdfUrl);
  const referer = captureContext?.sourcePageUrl || captureContext?.sourceTabUrl || "";
  const uploadResponse = await fetch(
    `${config.apiBaseUrl}/api/v1/vaults/${encodeURIComponent(vaultId)}/items/${encodeURIComponent(vaultPublicationId)}/pdf`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_url: pdfUrl,
        cookie_header: cookieHeader || undefined,
        referer: referer || undefined,
      }),
    },
  );

  const data = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok) {
    // 404 route_not_found means this backend doesn't have PDF storage yet.
    // Treat it as "feature not available" rather than an error so the popup
    // doesn't show a confusing failure message.
    if (uploadResponse.status === 404 || data?.error?.code === "route_not_found") {
      return null;
    }
    return {
      attempted: true,
      stored: false,
      message: data?.error?.message || `Drive upload failed (${uploadResponse.status}).`,
    };
  }

  return {
    attempted: true,
    stored: true,
    source_url: pdfUrl,
    fetch_strategy: "backend-source-url",
    ...data.data,
  };
}

async function getGoogleDriveStatus(forceRefresh) {
  const config = await loadConfig();
  assertConfigured(config);

  if (!forceRefresh && driveStatusCache.data && Date.now() - driveStatusCache.fetchedAt < CACHE_TTL_MS) {
    return driveStatusCache.data;
  }

  const response = await apiRequest(config, "/api/v1/extension/google-drive-status", { method: "GET" });
  driveStatusCache.data = response.data || {
    linked: false,
    folder_status: "unlinked",
    folder_name: null,
    folder_id: null,
  };
  driveStatusCache.fetchedAt = Date.now();
  return driveStatusCache.data;
}

function assertConfigured(config) {
  if (!config.apiBaseUrl || !config.apiKey) {
    throw new Error("Open settings and configure the refhub API key first.");
  }
}

async function apiRequest(config, pathname, init) {
  const response = await fetch(`${config.apiBaseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(init?.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `refhub API request failed (${response.status}).`;
    if (response.status === 401 || response.status === 403) {
      throw new Error(`refhub rejected the configured credentials. ${message}`);
    }
    throw new Error(message);
  }

  return data;
}

function pickWritableVaults(vaults) {
  return vaults.filter((vault) => ["owner", "editor"].includes(vault.permission));
}

function buildVaultUrl(config, vaultId) {
  const vault = vaultCache.data?.find?.((entry) => entry.id === vaultId);

  if (config.appBaseUrl) {
    if (vault?.visibility === "public" && vault?.public_slug) {
      return `${config.appBaseUrl}/public/${vault.public_slug}`;
    }

    return `${config.appBaseUrl}/vault/${vaultId}`;
  }
  return "";
}

function normalizeCapture(raw) {
  const url = sanitizeUrl(raw.canonicalUrl || raw.url || "");
  const hostname = getHostname(url);
  const citation = raw.meta.citation || {};
  const generic = raw.meta.generic || {};
  const openGraph = raw.meta.openGraph || {};
  const jsonLd = pickPreferredStructuredData(raw.structuredData);
  // publisherData is set by translator.enrichCapture (landing pages) or
  // translator.enrichWrapper (PDF viewer pages) when publisher-specific
  // extraction is needed (e.g. IEEE xplGlobal, ACM metadata API, Elsevier DOM).
  const pd = raw.publisherData || null;

  const title = firstNonEmpty(
    pd?.title,           // publisher-specific: clean title (no site/proceedings suffix)
    citation.title,
    jsonLd.headline,
    jsonLd.name,
    openGraph.title,
    generic.title,
    raw.documentTitle,
  );

  // When the publisher provides authors, use them exclusively — mixing in
  // generic/OG/citation sources can contaminate the list with strings like
  // "View Profile" or "ACM Conferences" (from site-level meta tags).
  const authors = pd?.authors?.length
    ? uniqueStrings(pd.authors)
    : uniqueStrings([
        ...arrayify(citation.authors),
        ...arrayify(jsonLd.authors),
        ...arrayify(generic.authors),
        ...arrayify(openGraph.authors),
      ]);

  const doi = normalizeDoi(
    firstNonEmpty(
      pd?.doi,
      citation.doi,
      jsonLd.doi,
      generic.doi,
      detectDoi(url),
      detectDoi(raw.documentTitle),
    ),
  );

  const journal = firstNonEmpty(pd?.journal, citation.journal, jsonLd.journal, generic.siteName, openGraph.siteName, hostname);
  const year = extractYear(firstNonEmpty(pd?.year?.toString(), citation.publicationDate, citation.onlineDate, jsonLd.datePublished, generic.publicationDate, openGraph.publishedTime));
  const abstract = firstNonEmpty(pd?.abstract, citation.abstract, jsonLd.abstract, openGraph.description, generic.description);
  const pageBase = sanitizeUrl(raw.canonicalUrl || raw.url || "");
  const pdfUrl = sanitizeUrl(firstNonEmpty(pd?.downloadUrl, citation.pdfUrl, generic.pdfUrl, raw.pdfLink), pageBase);
  const pageType = detectPageType({ url, doi, citation, jsonLd, raw });
  const publicationType = pageType === "generic-webpage" ? "webpage" : "article";
  const confidence = scoreConfidence({ pageType, doi, authors, journal, year, raw });
  const metadataSources = collectMetadataSources({ doi, citation, jsonLd, openGraph, generic, raw, pdfUrl });

  const item = compactObject({
    title,
    authors,
    year,
    journal,
    doi,
    url,
    abstract,
    publication_type: publicationType,
    pdf_url: pdfUrl,
  });

  const saveability = evaluateSaveability({ item, pageType });

  return {
    item,
    hostname,
    pageType,
    confidence,
    metadataSources,
    saveable: saveability.saveable,
    blockReason: saveability.reason,
    sourcePageUrl: raw.url || url,
  };
}

function evaluateSaveability({ item, pageType }) {
  if (!item.title || !item.url) {
    return {
      saveable: false,
      reason: "The page is missing a stable title or URL.",
    };
  }

  if (pageType === "generic-webpage") {
    return { saveable: true, reason: "" };
  }

  if (item.doi || item.authors?.length || item.journal || item.year || ["doi-landing", "scholarly-article", "preprint"].includes(pageType)) {
    return { saveable: true, reason: "" };
  }

  return {
    saveable: false,
    reason: "Metadata is too weak to save as a scholarly item.",
  };
}

function collectMetadataSources({ doi, citation, jsonLd, openGraph, generic, raw, pdfUrl }) {
  const sources = [];
  if (doi) {
    sources.push("doi");
  }
  if (Object.keys(citation).length) {
    sources.push("citation_meta");
  }
  if (Object.keys(jsonLd).length) {
    sources.push("json_ld");
  }
  if (Object.keys(openGraph).length) {
    sources.push("open_graph");
  }
  if (Object.keys(generic).length) {
    sources.push("generic_meta");
  }
  if (raw.canonicalUrl) {
    sources.push("canonical");
  }
  if (pdfUrl && raw.pdfLink && pdfUrl === sanitizeUrl(raw.pdfLink)) {
    sources.push("pdf_link");
  }
  return sources;
}

function detectPageType({ url, doi, citation, jsonLd, raw }) {
  if (/\barxiv\.org\b|\bbiorxiv\.org\b|\bmedrxiv\.org\b/i.test(url)) {
    return "preprint";
  }
  const hasScholarlyMeta = Boolean(citation.title || citation.doi || citation.journal || jsonLd.isScholarly);
  // publisherData being set means a translator enriched this page with structured
  // scholarly data (e.g. IEEE xplGlobal, ACM metadata API, Elsevier DOM).
  const hasPublisherData = Boolean(raw.publisherData?.doi || raw.publisherData?.authors?.length);
  if (doi && (hasScholarlyMeta || hasPublisherData)) {
    return "doi-landing";
  }
  if (hasScholarlyMeta || hasPublisherData) {
    return "scholarly-article";
  }
  if (raw.meta.openGraph.title || raw.documentTitle) {
    return "generic-webpage";
  }
  return "unsupported";
}

function scoreConfidence({ pageType, doi, authors, journal, year, raw }) {
  let score = 0.3;
  if (pageType === "doi-landing") {
    score += 0.35;
  } else if (pageType === "scholarly-article" || pageType === "preprint") {
    score += 0.25;
  } else if (pageType === "generic-webpage") {
    score += 0.1;
  }
  if (doi) {
    score += 0.15;
  }
  if (authors.length) {
    score += 0.1;
  }
  if (journal) {
    score += 0.05;
  }
  if (year) {
    score += 0.05;
  }
  if (raw.canonicalUrl) {
    score += 0.05;
  }
  return Math.max(0, Math.min(1, score));
}

function pickPreferredStructuredData(entries) {
  const flattened = Array.isArray(entries) ? entries.flatMap(flattenStructuredEntry) : [];
  const match =
    flattened.find((entry) => entry.isScholarly) ||
    flattened.find((entry) => entry.type === "Article") ||
    flattened.find((entry) => entry.type === "CreativeWork") ||
    flattened[0] ||
    {};

  return match;
}

function flattenStructuredEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return [];
  }

  if (Array.isArray(entry["@graph"])) {
    return entry["@graph"].flatMap(flattenStructuredEntry);
  }

  const rawType = entry["@type"];
  const type = Array.isArray(rawType) ? rawType[0] : rawType;

  return [
    compactObject({
      type,
      name: coerceString(entry.name),
      headline: coerceString(entry.headline),
      abstract: coerceString(entry.description || entry.abstract),
      datePublished: coerceString(entry.datePublished),
      doi: extractIdentifierValue(entry.identifier),
      journal: coerceString(entry.isPartOf?.name || entry.publisher?.name),
      authors: normalizeStructuredAuthors(entry.author),
      isScholarly: /ScholarlyArticle|Article|Report|Thesis/i.test(type || ""),
    }),
  ];
}

function normalizeStructuredAuthors(author) {
  if (!author) {
    return [];
  }
  const authors = Array.isArray(author) ? author : [author];
  return uniqueStrings(
    authors.map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      return entry?.name || [entry?.givenName, entry?.familyName].filter(Boolean).join(" ");
    }),
  );
}

function extractIdentifierValue(identifier) {
  if (!identifier) {
    return "";
  }
  const identifiers = Array.isArray(identifier) ? identifier : [identifier];
  for (const entry of identifiers) {
    const value = typeof entry === "string" ? entry : entry?.value || entry?.name || "";
    const doi = detectDoi(value);
    if (doi) {
      return doi;
    }
  }
  return "";
}

function extractYear(value) {
  if (!value) {
    return undefined;
  }
  const match = String(value).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function sanitizeUrl(value, base) {
  if (!value) {
    return "";
  }
  try {
    const parsed = new URL(value, base || globalThis.location?.href || undefined);
    const trackingParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];
    for (const key of trackingParams) {
      parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return String(value).trim();
  }
}

function getHostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}


async function buildCookieHeader(url) {
  if (!browserApi.cookies?.getAll) {
    return "";
  }

  try {
    const cookies = await browserApi.cookies.getAll({ url });
    const relevant = cookies
      .filter((cookie) => cookie?.name)
      .sort((left, right) => {
        const leftLength = left.path?.length || 0;
        const rightLength = right.path?.length || 0;
        return rightLength - leftLength;
      });

    const parts = [];
    let totalBytes = 0;
    for (const cookie of relevant) {
      const part = `${cookie.name}=${cookie.value}`;
      const nextBytes = new TextEncoder().encode(parts.length ? `; ${part}` : part).length;
      if (totalBytes + nextBytes > MAX_FORWARDED_COOKIE_BYTES) {
        break;
      }
      parts.push(part);
      totalBytes += nextBytes;
    }

    return parts.join("; ");
  } catch {
    return "";
  }
}

function extractMetadataFromHtml(html, baseUrl) {
  const metaEntries = [...html.matchAll(/<meta\s+[^>]*(?:name|property)=["']([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi)];
  const map = new Map();
  for (const [, rawKey, rawValue] of metaEntries) {
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim();
    if (!key || !value) {
      continue;
    }
    const bucket = map.get(key) || [];
    bucket.push(value);
    map.set(key, bucket);
  }

  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const doi = normalizeDoi(firstNonEmpty(pickMeta(map, "citation_doi"), pickMeta(map, "dc.identifier"), detectDoi(html), detectDoi(baseUrl)));

  // ACM DL landing pages have no citation_author meta tags — authors are only
  // in <a href="/profile/{id}">Name</a> anchor links on the abstract page.
  const acmProfileAuthors = [...html.matchAll(/href="\/profile\/\d+"[^>]*>([^<]+)/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);

  return compactObject({
    title: firstNonEmpty(pickMeta(map, "citation_title"), pickMeta(map, "og:title"), titleMatch?.[1] || ""),
    authors: uniqueStrings([...metaList(map, "citation_author"), ...acmProfileAuthors]),
    year: extractYear(firstNonEmpty(pickMeta(map, "citation_publication_date"), pickMeta(map, "article:published_time"), pickMeta(map, "dc.date"))),
    journal: firstNonEmpty(pickMeta(map, "citation_journal_title"), pickMeta(map, "citation_conference_title"), pickMeta(map, "og:site_name")),
    doi,
    url: sanitizeUrl(firstNonEmpty(pickMeta(map, "citation_public_url"), pickMeta(map, "og:url"), baseUrl)),
    abstract: firstNonEmpty(pickMeta(map, "citation_abstract"), pickMeta(map, "description"), pickMeta(map, "og:description")),
    pdf_url: sanitizeUrl(firstNonEmpty(pickMeta(map, "citation_pdf_url")), baseUrl),
  });
}

function pickMeta(map, key) {
  return map.get(key)?.find(Boolean) || "";
}

function metaList(map, key) {
  return map.get(key) || [];
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== undefined && value !== null && value !== "";
    }),
  );
}

function firstNonEmpty(...values) {
  return values.find((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return typeof value === "string" ? value.trim() : Boolean(value);
  }) || "";
}

function arrayify(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function uniqueStrings(values) {
  return [...new Set(values.map(coerceString).filter(Boolean))];
}

function coerceString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDoi(value) {
  const doi = detectDoi(value);
  return doi ? doi.toLowerCase() : "";
}

function detectDoi(value) {
  const match = String(value || "").match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
  return match ? match[0].replace(/[)>.,;]+$/, "") : "";
}

function extractPageMetadata() {
  const metaElements = Array.from(document.querySelectorAll("meta[name], meta[property]"));
  const meta = {
    citation: {},
    openGraph: {},
    generic: {},
  };

  for (const element of metaElements) {
    const key = (element.getAttribute("name") || element.getAttribute("property") || "").trim().toLowerCase();
    const value = (element.getAttribute("content") || "").trim();
    if (!key || !value) {
      continue;
    }

    if (key.startsWith("citation_")) {
      appendMetaValue(meta.citation, key, value);
      continue;
    }

    if (key.startsWith("og:") || key.startsWith("article:")) {
      appendMetaValue(meta.openGraph, key, value);
      continue;
    }

    appendMetaValue(meta.generic, key, value);
  }

  // Cloud reader pages (ACM, Wiley): extract from window.readerConfig when available.
  // Chrome's isolated world shares window with the page, so globalThis.readerConfig
  // is accessible here. Firefox uses XRay wrappers — the translator enrichWrapper
  // runs a separate MAIN-world executeScript to override this for Firefox.
  // Authors are always left empty here; enrichWrapper fills them via metadata API.
  let publisherData = null;
  try {
    const cfg = globalThis.readerConfig;
    if (cfg && cfg.doi) {
      const hmacRelUrl = cfg.epubConfig?.epubUrl || "";
      const dlRelUrl = hmacRelUrl || cfg.epubActions?.download?.files?.pdf?.url || "";
      publisherData = {
        title: cfg.title || "",
        doi: cfg.doi || "",
        downloadUrl: dlRelUrl ? new URL(dlRelUrl, location.href).href : "",
        authors: [],
        abstract: "",
      };
    }
  } catch {
    // Not a cloud reader page, or readerConfig is malformed — ignore.
  }

  return {
    url: location.href,
    canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || "",
    documentTitle: document.title || "",
    language: document.documentElement.lang || "",
    meta: normalizeMetaBuckets(meta),
    structuredData: extractStructuredData(),
    pdfLink: detectPdfLink(),
    publisherData,
  };

  function appendMetaValue(bucket, key, value) {
    if (!bucket[key]) {
      bucket[key] = value;
      return;
    }

    bucket[key] = Array.isArray(bucket[key]) ? [...bucket[key], value] : [bucket[key], value];
  }

  function normalizeMetaBuckets(input) {
    const citation = {
      title: pickFirst(input.citation["citation_title"]),
      authors: arrayFrom(input.citation["citation_author"]),
      doi: pickFirst(
        input.citation["citation_doi"],
        input.citation["citation_doi"],
        input.generic["dc.identifier"],
      ),
      journal: pickFirst(
        input.citation["citation_journal_title"],
        input.citation["citation_conference_title"],
      ),
      publicationDate: pickFirst(input.citation["citation_publication_date"]),
      onlineDate: pickFirst(input.citation["citation_online_date"]),
      abstract: pickFirst(input.citation["citation_abstract"]),
      pdfUrl: pickFirst(input.citation["citation_pdf_url"]),
    };

    const openGraph = {
      title: pickFirst(input.openGraph["og:title"]),
      description: pickFirst(input.openGraph["og:description"]),
      siteName: pickFirst(input.openGraph["og:site_name"]),
      publishedTime: pickFirst(input.openGraph["article:published_time"]),
      authors: arrayFrom(input.openGraph["article:author"]),
    };

    const generic = {
      title: pickFirst(input.generic["title"], input.generic["dc.title"]),
      description: pickFirst(input.generic["description"], input.generic["twitter:description"]),
      publicationDate: pickFirst(input.generic["dc.date"], input.generic["date"]),
      authors: arrayFrom(input.generic["author"], input.generic["dc.creator"]),
      siteName: pickFirst(input.generic["application-name"]),
      doi: pickFirst(input.generic["dc.identifier"], input.generic["dc.source"]),
      pdfUrl: pickFirst(input.generic["pdf_url"]),
    };

    return { citation, openGraph, generic };
  }

  function pickFirst(...values) {
    for (const value of values) {
      const items = arrayFrom(value);
      const first = items.find(Boolean);
      if (first) {
        return first;
      }
    }
    return "";
  }

  function arrayFrom(value) {
    if (!value) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }

  function extractStructuredData() {
    const nodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const values = [];
    for (const node of nodes) {
      const text = node.textContent?.trim();
      if (!text) {
        continue;
      }
      try {
        values.push(JSON.parse(text));
      } catch {
        continue;
      }
    }
    return values;
  }

  function detectPdfLink() {
    const embeds = Array.from(document.querySelectorAll("iframe[src], embed[src], object[data]"));
    const embeddedPdf = embeds.find((element) => {
      const value = element.getAttribute("src") || element.getAttribute("data") || "";
      return (
        /\.pdf(\?[^#]*)?(#.*)?$/i.test(value) ||
        /\/doi\/(e?pdf(direct)?|epdf)\//i.test(value) ||
        /\/content\/pdf\//i.test(value) ||
        /\/ielx?\d+\/.+\.pdf/i.test(value)
      );
    });
    if (embeddedPdf) {
      return embeddedPdf.getAttribute("src") || embeddedPdf.getAttribute("data") || "";
    }

    const anchors = Array.from(document.querySelectorAll("a[href]"));

    // Priority 1: href directly ends with .pdf
    const directPdf = anchors.find((a) => /\.pdf(\?[^#]*)?(#.*)?$/i.test(a.href));
    if (directPdf) {
      return directPdf.href;
    }

    // Priority 2: href contains a PDF-specific path segment used by major publishers
    // e.g. ACM /doi/pdf/, Wiley /doi/pdfdirect/, Elsevier /pdfft, Springer /content/pdf/
    const pathPdf = anchors.find((a) => /\/(e?pdf)(direct|ft|viewer)?[/?]/i.test(a.href) || /\/content\/pdf\//i.test(a.href));
    if (pathPdf) {
      return pathPdf.href;
    }

    // Priority 3: anchor label signals a PDF link AND the href also contains "pdf"
    // Requiring both prevents grabbing "View HTML full text" or nav items with pdf CSS classes
    const labelPattern = /\bpdf\b|\bfull[\s.\-_]?text\b/i;
    const labelPdf = anchors.find((a) => {
      const text = (a.textContent || "").trim();
      const title = (a.getAttribute("title") || a.getAttribute("aria-label") || "").trim();
      return (labelPattern.test(text) || labelPattern.test(title)) && /pdf/i.test(a.href);
    });
    if (labelPdf) {
      return labelPdf.href;
    }

    return "";
  }
}
