/**
 * Publisher translators — Zotero-style URL-pattern modules.
 *
 * Each translator implements:
 *   matches(url)               → bool   : does this translator own this URL?
 *   isWrapper(url)             → bool   : is this an HTML viewer, not a raw PDF?
 *   isBinaryPdf(url)           → bool   : is this a direct PDF binary URL?
 *   resolveLandingUrl(url)     → string : article landing / abstract page
 *   resolvePdfDownloadUrl(url) → string : URL that returns the actual PDF bytes
 *   enrichWrapper?(raw, tab, browserApi) → Promise<void>
 *                              : optional publisher-specific enrichment for wrapper pages
 *
 * Entries are checked in order; the first match wins.
 * Add a new per-publisher file and import it here to support additional publishers.
 */

import ieee from "./ieee.js";
import wiley from "./wiley.js";
import acm from "./acm.js";
import springer from "./springer.js";
import elsevier from "./elsevier.js";
import arxiv from "./arxiv.js";
import hal from "./hal.js";
import generic from "./generic.js";

const TRANSLATORS = [ieee, wiley, acm, springer, elsevier, arxiv, hal];

function _find(url) {
  return TRANSLATORS.find((t) => t.matches(url ?? "")) ?? generic;
}

/**
 * Returns the translator matched for the given URL (generic if none match).
 * Use this when you need the full translator object, e.g. to call enrichWrapper.
 */
export function findTranslator(url) {
  return _find(url);
}

/** True if this URL is an HTML viewer/wrapper, not a PDF binary. */
export function isPdfWrapper(url) {
  return _find(url).isWrapper(url ?? "");
}

/** True if this URL points directly to a PDF binary. */
export function isPdfBinary(url) {
  return _find(url).isBinaryPdf(url ?? "");
}

/**
 * Returns the article landing / abstract page URL for a given PDF or wrapper URL.
 * Falls back to the generic ?ref= decoder when no publisher-specific rule applies.
 */
export function resolveLandingUrl(url) {
  if (!url) return "";
  return _find(url).resolveLandingUrl(url) || generic.resolveLandingUrl(url);
}

/**
 * Returns the URL that will respond with the actual PDF bytes.
 * Strips URL fragments (#) — browsers don't send them to servers, but they
 * leak into logs and stored values when copied from the address bar.
 */
export function resolvePdfDownloadUrl(url) {
  if (!url) return url;
  const resolved = _find(url).resolvePdfDownloadUrl(url);
  // Strip fragment — e.g. "https://dl.acm.org/doi/pdfdirect/10.1145/...#" → no "#"
  return resolved ? resolved.split("#")[0] : resolved;
}

/** Returns the translator name matched for a given URL (useful for debugging). */
export function translatorName(url) {
  return _find(url).name;
}
