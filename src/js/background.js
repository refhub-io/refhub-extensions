import { browserApi } from "./browser-api.js";
import { loadConfig, saveConfig } from "./storage.js";

const runtimeApi = globalThis.browser ?? globalThis.chrome;

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

  const [{ result: raw }] = await browserApi.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageMetadata,
  });

  const normalized = normalizeCapture(raw);
  if (!normalized.saveable && normalized.pageType === "unsupported") {
    normalized.blockReason = normalized.blockReason || "This page type is not supported yet.";
  }
  return normalized;
}

async function saveItem(payload) {
  const config = await loadConfig();
  assertConfigured(config);

  const { vaultId, item } = payload || {};
  if (!vaultId) {
    throw new Error("A target vault is required.");
  }
  if (!item?.title) {
    throw new Error("The captured item is missing a title.");
  }

  const driveStatus = await getGoogleDriveStatus(false).catch(() => ({
    linked: false,
    folder_status: "unlinked",
    folder_name: null,
    folder_id: null,
  }));
  const shouldStorePdfInGoogleDrive = Boolean(item.pdf_url && driveStatus.linked);

  const response = await apiRequest(config, `/api/v1/vaults/${encodeURIComponent(vaultId)}/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [item],
      store_pdfs_in_google_drive: shouldStorePdfInGoogleDrive,
    }),
  });

  await saveConfig({ ...config, lastVaultId: vaultId });

  return {
    response,
    openUrl: buildVaultUrl(config, vaultId),
    driveStatus,
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

  const title = firstNonEmpty(
    citation.title,
    jsonLd.headline,
    jsonLd.name,
    openGraph.title,
    generic.title,
    raw.documentTitle,
  );

  const authors = uniqueStrings([
    ...arrayify(citation.authors),
    ...arrayify(jsonLd.authors),
    ...arrayify(generic.authors),
    ...arrayify(openGraph.authors),
  ]);

  const doi = normalizeDoi(
    firstNonEmpty(
      citation.doi,
      jsonLd.doi,
      generic.doi,
      detectDoi(url),
      detectDoi(raw.documentTitle),
    ),
  );

  const publicationDate = firstNonEmpty(
    citation.publicationDate,
    citation.onlineDate,
    jsonLd.datePublished,
    generic.publicationDate,
    openGraph.publishedTime,
  );

  const year = extractYear(publicationDate);
  const journal = firstNonEmpty(citation.journal, jsonLd.journal, generic.siteName, openGraph.siteName, hostname);
  const abstract = firstNonEmpty(citation.abstract, jsonLd.abstract, openGraph.description, generic.description);
  const pdfUrl = sanitizeUrl(firstNonEmpty(citation.pdfUrl, generic.pdfUrl));
  const pageType = detectPageType({ url, doi, citation, jsonLd, raw });
  const publicationType = pageType === "generic-webpage" ? "webpage" : "article";
  const confidence = scoreConfidence({ pageType, doi, authors, journal, year, raw });
  const metadataSources = collectMetadataSources({ doi, citation, jsonLd, openGraph, generic, raw });

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

function collectMetadataSources({ doi, citation, jsonLd, openGraph, generic, raw }) {
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
  return sources;
}

function detectPageType({ url, doi, citation, jsonLd, raw }) {
  if (/\.pdf($|\?)/i.test(url)) {
    return "unsupported";
  }
  if (/\barxiv\.org\b|\bbiorxiv\.org\b|\bmedrxiv\.org\b/i.test(url)) {
    return "preprint";
  }
  const hasScholarlyMeta = Boolean(citation.title || citation.doi || citation.journal || jsonLd.isScholarly);
  if (doi && hasScholarlyMeta) {
    return "doi-landing";
  }
  if (hasScholarlyMeta) {
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

function sanitizeUrl(value) {
  if (!value) {
    return "";
  }
  try {
    const parsed = new URL(value, globalThis.location?.href || undefined);
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

  return {
    url: location.href,
    canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || "",
    documentTitle: document.title || "",
    language: document.documentElement.lang || "",
    meta: normalizeMetaBuckets(meta),
    structuredData: extractStructuredData(),
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
}
