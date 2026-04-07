// ── HAL (Hyper Articles en Ligne) ───────────────────────────────────────────
// hal.science / hal.archives-ouvertes.fr — French open archive
// Also covers institutional HAL portals: hal.inrae.fr, hal.inria.fr, etc.
//
// URL patterns:
//   /hal-{id}              — landing page (abstract + citation meta tags)
//   /hal-{id}v{version}    — versioned landing page
//   /hal-{id}/document     — PDF binary (no .pdf extension, served inline)
//   /hal-{id}v{ver}/document  — versioned PDF binary
//   /hal-{id}/file/{name}.pdf — alternate PDF binary path

export default {
  name: "hal",
  // Matches hal.science, hal.archives-ouvertes.fr, and institutional subdomains
  // like hal.inrae.fr, hal.inria.fr, hal.sorbonne-universite.fr, etc.
  matches: (url) => /\bhal\.(?:science|archives-ouvertes\.fr|[a-z0-9-]+\.fr)\b/i.test(url),
  isWrapper: () => false,
  // /document has no .pdf extension but is a direct PDF binary;
  // /file/...pdf files also serve PDFs directly.
  isBinaryPdf: (url) => /\/hal-\d+(?:v\d+)?\/document\b/i.test(url) || /\/hal-\d+(?:v\d+)?\/file\//i.test(url),
  resolveLandingUrl: (url) => {
    // Strip the PDF-specific suffix to get the base abstract page.
    // /hal-05579012v1/document  → /hal-05579012v1
    // /hal-05579012/file/...    → /hal-05579012
    const m = url.match(/^(https?:\/\/[^/]+\/hal-\d+(?:v\d+)?)/i);
    return m ? m[1] : url;
  },
  resolvePdfDownloadUrl: (url) => url,
};
