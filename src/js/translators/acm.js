// ── ACM Digital Library ─────────────────────────────────────────────────────
// /doi/{doi}       — article landing page (no citation_* meta tags; OG title
//                    includes "| Proceedings of..." suffix)
// /doi/epdf/{doi}  — HTML cloud reader wrapper (window.readerConfig present)
// /doi/pdf/{doi}   — legacy HTML viewer wrapper
// /doi/pdfdirect/  — PDF binary; requires session-specific hmac token
//
// For both the landing page and the epdf wrapper, the clean metadata (title,
// authors, abstract) lives at /doi/reader/metadata/{doi}. That endpoint returns
// { itemInfo: { metadata: "<html>...", abstract: "<html>..." } } with:
//   - Authors: <span class="author">Name, </span>
//   - Title:   <h4 class="title">Clean article title</h4>
//   - Abstract: HTML string in the "abstract" field

// Runs in MAIN world — synchronous, self-contained (no closure over module scope).
// window.readerConfig is page-defined; blocked by Firefox XRay wrappers in the
// isolated world so MAIN world is required.
function readReaderConfig() {
  try {
    const c = window.readerConfig;
    if (!c || !c.doi) return null;
    return {
      title: c.title || "",
      doi: c.doi || "",
      metadataUrl: c.metadataUrl || "",
      hmacUrl: (c.epubConfig && c.epubConfig.epubUrl) || "",
      fallbackUrl: (c.epubActions && c.epubActions.download && c.epubActions.download.files &&
                   c.epubActions.download.files.pdf && c.epubActions.download.files.pdf.url) || "",
    };
  } catch (e) {
    return null;
  }
}

// Runs in isolated world — fetches a URL with session credentials and returns parsed JSON.
// Self-contained (no closure over module scope).
function fetchJsonFromPageContext(url) {
  return fetch(url, { credentials: "include" })
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });
}

// Shared logic for parsing the ACM metadata API response.
// Returns { authors, title, abstract } or null if the response is unusable.
function _parseMetadataResponse(metaJson) {
  if (!metaJson || !metaJson.itemInfo) return null;
  const { metadata: metaHtml = "", abstract: abstractHtml = "" } = metaJson.itemInfo;

  const authors = [...metaHtml.matchAll(/<span[^>]*class="author"[^>]*>([^<]+)<\/span>/gi)]
    .map((m) => m[1].replace(/\s+/g, " ").trim().replace(/\s*,\s*$/, "").replace(/\s+and\s*$/i, "").trim())
    .filter(Boolean);

  const titleMatch = metaHtml.match(/<h4[^>]*class="title"[^>]*>([^<]+)<\/h4>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";

  const abstract = abstractHtml
    ? abstractHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().replace(/^Abstract\s*/i, "").trim()
    : "";

  return { authors, title, abstract };
}

export default {
  name: "acm",
  matches: (url) => /\bdl\.acm\.org\b/i.test(url),
  isWrapper: (url) => /\/doi\/e?pdf\//i.test(url),
  // pdfdirect URLs with hmac are binary PDFs (stored directly as pdf_url)
  isBinaryPdf: (url) => /\/doi\/pdfdirect\//i.test(url),
  resolveLandingUrl: (url) => {
    const m = url.match(/^(https?:\/\/[^/]+)\/doi\/e?pdf\/([^#?]+)/i);
    return m ? `${m[1]}/doi/${m[2]}` : "";
  },
  // Only rewrite wrapper URLs — no-op for pdfdirect (already a binary URL).
  resolvePdfDownloadUrl: (url) => {
    const m = url.match(/^(https?:\/\/[^/]+)\/doi\/e?pdf\/([^#?]+)/i);
    return m ? `${m[1]}/doi/pdf/${m[2]}?download=true` : url;
  },

  /**
   * Enriches `raw` from an ACM landing page (/doi/{doi}).
   * ACM landing pages have no citation_* meta tags; the OG title includes a
   * proceedings suffix. The metadata API provides clean title, authors, abstract.
   */
  async enrichCapture(raw, tab, browserApi) {
    const origin = new URL(tab.url).origin;
    // Derive metadata URL: /doi/10.1145/... → /doi/reader/metadata/10.1145/...
    const metadataUrl = new URL(tab.url).pathname
      .replace(/^\/doi\//, "/doi/reader/metadata/");

    if (!metadataUrl.startsWith("/doi/reader/metadata/10.")) return;

    let metaJson = null;
    try {
      const [{ result }] = await browserApi.scripting.executeScript({
        target: { tabId: tab.id },
        args: [`${origin}${metadataUrl}`],
        func: fetchJsonFromPageContext,
      });
      metaJson = result;
    } catch { /* fetch failed */ }

    const parsed = _parseMetadataResponse(metaJson);
    if (parsed && (parsed.authors.length > 0 || parsed.title)) {
      raw.publisherData = {
        title: parsed.title || raw.publisherData?.title || "",
        doi: raw.publisherData?.doi || "",
        downloadUrl: raw.publisherData?.downloadUrl || "",
        authors: parsed.authors,
        abstract: parsed.abstract,
      };
    }
  },

  /**
   * Enriches `raw` from an ACM PDF wrapper page (/doi/epdf/ or /doi/pdf/).
   *
   * Step 1 — MAIN world sync read of window.readerConfig:
   *   Gets doi, title, and the hmac-bearing pdfdirect URL (epubConfig.epubUrl).
   *   Firefox isolated world cannot access page-defined window properties (XRay
   *   wrapper), so MAIN world is required.
   *
   * Step 2 — isolated world fetch of /doi/reader/metadata/{doi}:
   *   Returns { itemInfo: { metadata: "<html>...", abstract: "<html>..." } }.
   *   Authors in <span class="author">, title in <h4 class="title">.
   */
  async enrichWrapper(raw, tab, browserApi) {
    // Step 1: read window.readerConfig from MAIN world.
    let config = null;
    try {
      const [{ result }] = await browserApi.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: readReaderConfig,
      });
      config = result;
    } catch { /* MAIN world unsupported — fall through */ }

    // Step 2: fetch metadata API from isolated world (same-origin, CF-trusted).
    const origin = new URL(tab.url).origin;
    const metadataUrl = config?.metadataUrl
      ? `${origin}${config.metadataUrl}`
      : tab.url.replace(/\/doi\/e?pdf\//i, "/doi/reader/metadata/").split("?")[0].split("#")[0];

    let metaJson = null;
    try {
      const [{ result }] = await browserApi.scripting.executeScript({
        target: { tabId: tab.id },
        args: [metadataUrl],
        func: fetchJsonFromPageContext,
      });
      metaJson = result;
    } catch { /* metadata fetch failed */ }

    const parsed = _parseMetadataResponse(metaJson);

    if (config || (parsed && (parsed.authors.length > 0 || parsed.title))) {
      const relUrl = config?.hmacUrl || config?.fallbackUrl || "";
      raw.publisherData = {
        title: parsed?.title || config?.title || raw.publisherData?.title || "",
        doi: config?.doi || raw.publisherData?.doi || "",
        downloadUrl: relUrl ? new URL(relUrl, origin).href : (raw.publisherData?.downloadUrl || ""),
        authors: parsed?.authors || [],
        abstract: parsed?.abstract || "",
      };
    }
  },
};
