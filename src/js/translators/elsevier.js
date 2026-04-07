// ── Elsevier / ScienceDirect ────────────────────────────────────────────────
// sciencedirect.com — article pages at /science/article/pii/{PII}
//
// citation_* meta tags are present for doi, title, journal, dates — but
// citation_author is ABSENT. Authors are rendered in DOM as:
//   <button class="button-link" inside #author-group>
//     <span class="given-name">Firstname</span>
//     <span class="surname">Lastname</span>
//   </button>
//
// PDF URL: no citation_pdf_url meta tag. The "View PDF" link uses path /pdfft
// and is present as an anchor in the accessbar. We read both in one injection.

// Runs in isolated world — DOM access only, no page globals needed.
// Self-contained (no closure over module scope).
function extractElsevierPageData() {
  try {
    // Authors from #author-group buttons
    const buttons = document.querySelectorAll('#author-group button.button-link');
    const authors = [];
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var given = (btn.querySelector('.given-name') || {}).textContent || '';
      var surname = (btn.querySelector('.surname') || {}).textContent || '';
      var name = (given.trim() + ' ' + surname.trim()).trim();
      if (name) authors.push(name);
    }

    // PDF URL: look for the /pdfft link in the accessbar or the page body
    var pdfUrl = '';
    var anchors = document.querySelectorAll('a[href]');
    for (var j = 0; j < anchors.length; j++) {
      var href = anchors[j].href || '';
      if (/\/pdfft[?/]/i.test(href) || /\/pdf\//i.test(href)) {
        pdfUrl = href;
        break;
      }
    }

    return { authors: authors.length ? authors : null, pdfUrl: pdfUrl || null };
  } catch (e) {
    return null;
  }
}

export default {
  name: "elsevier",
  matches: (url) => /\bsciencedirect\.com\b/i.test(url),
  isWrapper: () => false,
  // ScienceDirect presigned PDFs are served from pdf.sciencedirectassets.com —
  // that domain doesn't match `sciencedirect.com` so generic handles it via
  // the .pdf extension. Direct /pdfft paths on sciencedirect.com are not binary
  // PDFs (they're redirectors), so we leave isBinaryPdf false here.
  isBinaryPdf: () => false,
  resolveLandingUrl: (url) => url,
  resolvePdfDownloadUrl: (url) => url,

  /**
   * Enriches `raw` with authors and PDF URL extracted from the ScienceDirect DOM.
   * All other fields (doi, title, journal, date) come from citation_* meta tags.
   */
  async enrichCapture(raw, tab, browserApi) {
    let result = null;
    try {
      const [{ result: data }] = await browserApi.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractElsevierPageData,
      });
      result = data;
    } catch { /* extraction failed */ }

    const authors = result?.authors;
    const pdfUrl = result?.pdfUrl || "";

    if (authors?.length || pdfUrl) {
      raw.publisherData = {
        title: raw.publisherData?.title || "",
        doi: raw.publisherData?.doi || "",
        downloadUrl: pdfUrl || raw.publisherData?.downloadUrl || "",
        authors: authors || raw.publisherData?.authors || [],
        abstract: raw.publisherData?.abstract || "",
      };
    }
  },
};
