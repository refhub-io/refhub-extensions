// Generic fallback — pattern-based, no publisher-specific knowledge.
export default {
  name: "generic",
  matches: () => true,
  isWrapper: () => false,
  isBinaryPdf: (url) =>
    /\.pdf(\?[^#]*)?(#.*)?$/i.test(url) || /\/content\/pdf\//i.test(url),
  resolveLandingUrl: (url) => {
    // Some publishers (e.g. IEEE PDF binaries) encode the landing URL as
    // a base64 ?ref= query parameter.
    try {
      const ref = new URL(url).searchParams.get("ref");
      if (ref) {
        const decoded = atob(ref);
        if (/^https?:\/\//i.test(decoded)) return decoded;
      }
    } catch {
      // ignore malformed URLs / invalid base64
    }
    return "";
  },
  resolvePdfDownloadUrl: (url) => url,
};
