// ── Wiley Online Library ────────────────────────────────────────────────────
// /doi/full/{doi}     — landing page (rich citation_* meta tags — works as-is)
// /doi/epdf/{doi}     — HTML cloud reader wrapper (window.readerConfig present)
// /doi/pdf/{doi}      — legacy HTML viewer wrapper
// /doi/pdfdirect/{doi} — PDF binary (with optional hmac token)
//
// The /doi/epdf/ and /doi/pdf/ pages use the same Wiley/Atypon cloud reader as
// ACM, including window.readerConfig with the same field layout and a
// /doi/reader/metadata/{doi} endpoint that returns the same HTML-encoded response.

// Runs in MAIN world — synchronous, self-contained (no closure over module scope).
// window.readerConfig is page-defined; blocked by Firefox XRay wrappers in
// isolated world, so MAIN world is required.
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

export default {
  name: "wiley",
  matches: (url) => /onlinelibrary\.wiley\.com/i.test(url),
  // Only the HTML viewer pages are wrappers; pdfdirect is a binary PDF
  isWrapper: (url) => /\/doi\/e?pdf\//i.test(url),
  isBinaryPdf: (url) => /\/doi\/pdfdirect\//i.test(url),
  resolveLandingUrl: (url) => {
    const m = url.match(/\/doi\/e?pdf(?:direct)?\/(.+?)(?:\?.*)?$/i);
    return m ? `https://onlinelibrary.wiley.com/doi/full/${m[1]}` : "";
  },
  // Swap any /epdf/ or /pdf/ variant for /pdfdirect/ to get the raw binary.
  resolvePdfDownloadUrl: (url) =>
    url.replace(/\/doi\/e?pdf(?:direct)?\//, "/doi/pdfdirect/"),

  /**
   * Enriches `raw` with Wiley-specific metadata from the cloud reader.
   * The /doi/epdf/ page uses the same Wiley/Atypon reader infrastructure as ACM:
   *   Step 1 — MAIN world sync read of window.readerConfig (doi, title, hmac URL)
   *   Step 2 — isolated world fetch of /doi/reader/metadata/{doi} for authors + abstract
   *
   * The metadata response format mirrors ACM: { itemInfo: { metadata: "<html>...",
   * abstract: "<html>..." } } with authors in <span class="author"> elements.
   */
  async enrichWrapper(raw, tab, browserApi) {
    let config = null;
    try {
      const [{ result }] = await browserApi.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: readReaderConfig,
      });
      config = result;
    } catch { /* MAIN world unsupported — fall through */ }

    const origin = new URL(tab.url).origin;
    const metadataUrl = config?.metadataUrl
      ? `${origin}${config.metadataUrl}`
      : tab.url.replace(/\/doi\/e?pdf\//i, "/doi/reader/metadata/").split("?")[0].split("#")[0];

    let authors = [];
    let metaTitle = "";
    let metaAbstract = "";
    try {
      const [{ result: metaJson }] = await browserApi.scripting.executeScript({
        target: { tabId: tab.id },
        args: [metadataUrl],
        func: fetchJsonFromPageContext,
      });
      if (metaJson && metaJson.itemInfo) {
        const { metadata: metaHtml = "", abstract: abstractHtml = "" } = metaJson.itemInfo;

        // Authors: <span class="author">Name, </span>
        authors = [...metaHtml.matchAll(/<span[^>]*class="author"[^>]*>([^<]+)<\/span>/gi)]
          .map((m) => m[1].replace(/\s+/g, " ").trim().replace(/\s*,\s*$/, "").replace(/\s+and\s*$/i, "").trim())
          .filter(Boolean);

        // Title: <h4 class="title">Clean article title</h4>
        const titleMatch = metaHtml.match(/<h4[^>]*class="title"[^>]*>([^<]+)<\/h4>/i);
        if (titleMatch) metaTitle = titleMatch[1].trim();

        if (abstractHtml) {
          metaAbstract = abstractHtml
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/^Abstract\s*/i, "")
            .trim();
        }
      }
    } catch { /* metadata fetch failed */ }

    if (config || authors.length > 0 || metaTitle) {
      const relUrl = config?.hmacUrl || config?.fallbackUrl || "";
      raw.publisherData = {
        title: metaTitle || config?.title || raw.publisherData?.title || "",
        doi: config?.doi || raw.publisherData?.doi || "",
        downloadUrl: relUrl ? new URL(relUrl, origin).href : (raw.publisherData?.downloadUrl || ""),
        authors,
        abstract: metaAbstract,
      };
    }
  },
};
