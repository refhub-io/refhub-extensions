# RefHub Browser Extension Prototype

This repo contains the first working RefHub browser extension prototype described in [`docs/spec.md`](/opt/openclaw/projects/r2d2/refhub-extensions/docs/spec.md). It is Chrome-first on Manifest V3, keeps scope narrow, and uses a single shared source tree that can emit Chrome and Firefox builds.

## What the prototype does

- reads the current tab URL on user action
- extracts a small metadata bundle from the page using canonical URL, citation meta tags, JSON-LD, Open Graph, and document metadata
- shows a popup preview with page type, DOI, source, and normalized item fields
- lets the user configure a RefHub API base URL and API key
- lists writable vaults from RefHub and saves a single item with `POST /api/v1/vaults/:vaultId/items`
- reports clear setup, extraction, auth, and save errors

## Build

```bash
npm run build
```

Optional build-time defaults:

```bash
REFHUB_API_BASE_URL=https://refhub-api.netlify.app \
REFHUB_APP_BASE_URL=https://refhub.io \
npm run build
```

Build output:

- `dist/chrome`
- `dist/firefox`

## Load locally

### Chrome / Chromium

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable Developer Mode.
4. Click `Load unpacked`.
5. Select [`dist/chrome`](/opt/openclaw/projects/r2d2/refhub-extensions/dist/chrome).

### Firefox

1. Run `npm run build`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click `Load Temporary Add-on...`.
4. Select [`dist/firefox/manifest.json`](/opt/openclaw/projects/r2d2/refhub-extensions/dist/firefox/manifest.json).

Chrome is the primary target for this prototype. The Firefox build is generated from the same codebase but is not yet verified end-to-end.

## Configure and test

1. Open the extension options page.
2. Set `RefHub API base URL`, for example `https://refhub-api.netlify.app`.
3. Set `RefHub app URL`, for example `https://refhub.io`.
4. Paste a RefHub API key with `vaults:read` and `vaults:write`.
5. Open a supported page and click the extension action.
6. Confirm the preview, choose a writable vault, and click `Save to RefHub`.

Expected v1-supported pages:

- DOI landing pages
- pages with `citation_*` metadata
- pages with article-like JSON-LD
- generic webpages with usable title and URL fallback

Expected v1 exclusions:

- direct PDF tabs
- multi-item search/index pages
- background crawling or persistent site access
- full auth/token exchange inside the extension

## Architecture

- `src/js/background.js`: service worker, extraction orchestration, RefHub API calls, vault caching
- `src/js/popup.js`: capture preview, vault picker, save flow
- `src/js/options.js`: API base URL and API key configuration
- `scripts/build.mjs`: emits browser-specific manifests from one shared source tree

The prototype uses `activeTab` + `scripting.executeScript` so capture only happens after explicit user action. It does not keep persistent access to arbitrary sites.

## Cross-browser strategy

Zotero’s connector architecture is a useful concept reference here: keep the extraction and product logic shared, and isolate browser runtime differences in a thin adapter/build layer instead of forking the whole extension. We can follow that same general approach without borrowing code.

Practical same-codebase strategy for RefHub:

- share popup UI, extraction heuristics, normalization, storage schema, and RefHub API client logic
- generate per-browser manifests and keep a small runtime compatibility layer for `chrome` vs `browser` APIs
- expect browser-specific handling around auth handoff, service worker lifecycle differences, and any APIs that are still uneven in Firefox MV3
- keep capture initiated by user action with `activeTab` semantics in both browsers

Conclusion: same-codebase multi-browser builds are realistic for this extension. Chrome-first is sensible for v1, and Firefox support should be an incremental adapter-and-testing exercise rather than a separate implementation.
