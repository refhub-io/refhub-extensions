// ── Springer Link ───────────────────────────────────────────────────────────
// /content/pdf/*.pdf — direct PDF binary
// /article/*         — landing page (may embed a viewer)

export default {
  name: "springer",
  matches: (url) => /\blink\.springer\.com\b/i.test(url),
  isWrapper: (url) => /\/article\//i.test(url),
  isBinaryPdf: (url) => /\/content\/pdf\/.+\.pdf/i.test(url),
  resolveLandingUrl: (url) =>
    url.replace(/\/content\/pdf\/(.+)\.pdf.*$/, "/article/$1"),
  resolvePdfDownloadUrl: (url) => url,
};
