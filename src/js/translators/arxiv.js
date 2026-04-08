// ── arXiv ────────────────────────────────────────────────────────────────────
// arxiv.org/abs/{id}   — abstract landing page (has citation_* meta tags — works as-is)
// arxiv.org/pdf/{id}   — direct PDF binary
// arxiv.org/html/{id}  — HTML full-text viewer (LaTeXML; NO meta tags at all)
//
// enrichCapture only runs for /html/{id} pages.  The LaTeXML renderer places:
//   - Title:    <h1 class="ltx_title ltx_title_document">
//   - Authors:  <span class="ltx_creator ltx_role_author">
//                 <span class="ltx_personname">Name1, Name2, ...</span>
//               (superscript affiliation markers are in <sup> children)
//   - Abstract: <div class="ltx_abstract"> <p class="ltx_p">

// Runs in isolated world — DOM access only, no page globals needed.
// Self-contained (no closure over module scope).
function extractArxivHtmlPageData() {
  try {
    // Title
    var titleEl = document.querySelector('h1.ltx_title.ltx_title_document');
    var title = titleEl ? titleEl.textContent.replace(/\s+/g, ' ').trim() : '';

    // Authors: walk text nodes inside ltx_personname to skip <sup> superscripts
    var authors = [];
    var personname = document.querySelector('.ltx_creator.ltx_role_author .ltx_personname');
    if (personname) {
      var rawText = '';
      personname.childNodes.forEach(function(node) {
        if (node.nodeType === 3) rawText += node.textContent; // text nodes only
      });
      rawText.split(',').forEach(function(part) {
        var name = part.replace(/\s+/g, ' ').trim().replace(/[,\s]+$/, '').trim();
        if (name) authors.push(name);
      });
    }

    // Abstract: first <p> inside .ltx_abstract (may contain inline MathML)
    var abstractEl = document.querySelector('.ltx_abstract .ltx_p');
    var abstract = abstractEl ? abstractEl.textContent.replace(/\s+/g, ' ').trim() : '';

    // Derive PDF URL: /html/2308.12628v3 → /pdf/2308.12628v3
    var pdfUrl = location.href.replace(/\/html\//, '/pdf/').replace(/[?#].*$/, '');

    if (!title && !authors.length) return null;
    return { title: title, authors: authors, abstract: abstract, downloadUrl: pdfUrl };
  } catch (e) {
    return null;
  }
}

export default {
  name: "arxiv",
  matches: (url) => /\barxiv\.org\b/i.test(url),
  isWrapper: () => false,
  isBinaryPdf: (url) => /\/pdf\//i.test(url),
  resolveLandingUrl: (url) => {
    // /pdf/{id} or /html/{id} → /abs/{id}
    return url.replace(/\/(pdf|html)\//, '/abs/').replace(/[?#].*$/, '');
  },
  resolvePdfDownloadUrl: (url) => {
    // /abs/{id} or /html/{id} → /pdf/{id}
    return url.replace(/\/(abs|html)\//, '/pdf/').replace(/[?#].*$/, '');
  },

  /**
   * Enriches `raw` from an arXiv HTML full-text viewer (/html/{id}).
   * The LaTeXML viewer has no meta tags; all metadata must be extracted from DOM.
   * For /abs/ pages the standard citation_* extraction already works — skip.
   */
  async enrichCapture(raw, tab, browserApi) {
    // Only the HTML full-text viewer needs DOM extraction
    if (!/\/html\//i.test(tab.url)) return;

    let result = null;
    try {
      const [{ result: data }] = await browserApi.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractArxivHtmlPageData,
      });
      result = data;
    } catch { /* extraction failed */ }

    if (result && (result.title || result.authors.length)) {
      raw.publisherData = {
        title: result.title || "",
        doi: "",           // HTML viewer pages don't expose the DOI
        downloadUrl: result.downloadUrl || "",
        authors: result.authors,
        abstract: result.abstract || "",
      };
    }
  },
};
