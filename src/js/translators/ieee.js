// ── IEEE Xplore ────────────────────────────────────────────────────────────
// /document/{id}/    — article landing page (no citation_ meta tags; all data
//                      is in the xplGlobal.document.metadata JS global)
// /stamp/stamp.jsp   — HTML PDF viewer/wrapper (no metadata; resolve via ?arnumber=)
// /ielx8/.../*.pdf   — direct PDF binary URL

// Runs in MAIN world — synchronous, self-contained.
// xplGlobal is page-defined so it is blocked by Firefox XRay wrappers in the
// isolated world; MAIN world is required.
function readIeeeMetadata() {
  try {
    const m = window.xplGlobal &&
              window.xplGlobal.document &&
              window.xplGlobal.document.metadata;
    if (!m || !m.doi) return null;
    return {
      // formulaStrippedArticleTitle has LaTeX stripped; fall back to title
      title: m.formulaStrippedArticleTitle || m.title || "",
      doi: m.doi || "",
      // authorNames is a semicolon-separated string — the cleanest author source
      authors: (m.authorNames || "").split(";").map(function(s) { return s.trim(); }).filter(Boolean),
      // abstract may contain inline HTML markup (math, monospace, etc.)
      abstract: (m.abstract || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      journal: m.publicationTitle || "",
      year: m.publicationYear ? (parseInt(m.publicationYear, 10) || undefined) : undefined,
    };
  } catch (e) {
    return null;
  }
}

// Runs in MAIN world — reads the iframe src from the stamp.jsp PDF viewer.
// The iframe contains the actual PDF binary URL (/ielx8/...pdf?arnumber=...).
// Self-contained (no closure over module scope).
function readIeeeStampIframeSrc() {
  try {
    var iframes = document.querySelectorAll('iframe[src]');
    for (var i = 0; i < iframes.length; i++) {
      var src = iframes[i].getAttribute('src') || '';
      if (/\/ielx?\d+\/.+\.pdf/i.test(src)) {
        return src.indexOf('http') === 0 ? src : location.origin + src;
      }
    }
    return '';
  } catch (e) { return ''; }
}

function _param(url, key) {
  try { return new URL(url).searchParams.get(key) || ""; }
  catch { return ""; }
}

export default {
  name: "ieee",
  matches: (url) => /ieeexplore\.ieee\.org/i.test(url),
  isWrapper: (url) => /\/stamp\/stamp\.jsp\b/i.test(url),
  // e.g. /ielx8/2945/10858457/10787140.pdf
  isBinaryPdf: (url) => /\/ielx?\d+\/.+\.pdf/i.test(url),
  resolveLandingUrl: (url) => {
    // Both stamp.jsp wrapper URLs and PDF binary URLs carry ?arnumber=
    const arnumber = _param(url, "arnumber");
    return arnumber ? `https://ieeexplore.ieee.org/document/${arnumber}/` : "";
  },
  // The stamp.jsp URL itself redirects server-side to the PDF binary — no change needed.
  resolvePdfDownloadUrl: (url) => url,

  /**
   * Enriches `raw` with the explicit PDF binary URL from the stamp.jsp iframe.
   * detectPdfLink already catches this via regex, but reading it explicitly here
   * ensures the correct URL is stored in publisherData.downloadUrl regardless
   * of DOM timing or iframe load state.
   */
  async enrichWrapper(raw, tab, browserApi) {
    let iframeSrc = "";
    try {
      const [{ result }] = await browserApi.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: readIeeeStampIframeSrc,
      });
      iframeSrc = result || "";
    } catch { /* MAIN world unsupported or no iframe found */ }

    if (iframeSrc) {
      raw.publisherData = {
        ...(raw.publisherData || {}),
        downloadUrl: iframeSrc,
      };
    }
  },

  /**
   * Enriches `raw` with IEEE-specific metadata from xplGlobal.document.metadata.
   * IEEE landing pages have no citation_* or JSON-LD metadata; all structured
   * data is in a JS global set inline by the page.
   */
  async enrichCapture(raw, tab, browserApi) {
    let result = null;
    try {
      const [{ result: data }] = await browserApi.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: readIeeeMetadata,
      });
      result = data;
    } catch { /* MAIN world unsupported or page lacks xplGlobal */ }

    if (result && (result.doi || result.authors.length)) {
      raw.publisherData = {
        title: result.title || "",
        doi: result.doi || "",
        downloadUrl: "",  // stamp.jsp resolved on PDF save; not a binary URL
        authors: result.authors,
        abstract: result.abstract || "",
        journal: result.journal || "",
        year: result.year,
      };
    }
  },
};
