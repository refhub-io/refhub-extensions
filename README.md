# RefHub Browser Extension Prototype

This repo contains the first working RefHub browser extension prototype described in [`docs/spec.md`](/opt/openclaw/projects/r2d2/refhub-extensions/docs/spec.md). It keeps scope narrow, uses one shared source tree, and now emits browser-specific manifests so both Chrome and Firefox builds are loadable from the same codebase.

## What the prototype does

- reads the current tab URL on user action
- extracts a small metadata bundle from the page using canonical URL, citation meta tags, JSON-LD, Open Graph, and document metadata
- shows a popup preview with page type, DOI, source, and normalized item fields
- lets the user configure a RefHub API base URL and API key
- lists writable vaults from RefHub and saves a single item with `POST /api/v1/vaults/:vaultId/items`
- opens the matching RefHub route after save: `/public/:slug` for public vaults, `/vault/:id` for private or shared vaults
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

Manifest strategy:

- Chrome build keeps MV3 `background.service_worker`
- Firefox build swaps to MV3 `background.scripts` so it loads as a temporary add-on in Firefox without forking the runtime code

Branding:

- extension icons are derived from the existing RefHub favicon asset, reused as the cleanest available project-owned identity mark for now

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

Firefox is generated from the same codebase with a browser-specific background manifest shim. The temporary add-on entrypoint is [`dist/firefox/manifest.json`](/opt/openclaw/projects/r2d2/refhub-extensions/dist/firefox/manifest.json).

## Configure and test

1. Sign in to RefHub web app.
2. Open `https://refhub.io/profile-edit`.
3. Switch to the `api_keys` tab.
4. Create a key with `vaults:read` and `vaults:write`.
5. Optionally restrict the key to selected vaults for least-privilege access.
6. Open the extension options page.
7. Set `RefHub API base URL` to the backend root, for example `https://refhub-api.netlify.app`.
8. Set `RefHub app URL` to the frontend root, for example `https://refhub.io`.
9. Paste the API key.
10. Open a supported page and click the extension action.
11. Confirm the preview, choose a writable vault, and click `save_to_refhub`.

Important setup details:

- `RefHub API base URL` is the backend origin only. Do not append `/api/v1`.
- `RefHub app URL` is the frontend origin used for post-save links.
- Current frontend key-creation path is `/profile-edit` → `api_keys`.
- The extension only surfaces writable vaults (`owner` or `editor` access).

Required API-key scopes:

- `vaults:read` to list accessible vaults
- `vaults:write` to create items in the selected vault

Not required for this extension:

- `vaults:export`

Extension permissions and why they exist:

- `activeTab` so capture only runs after explicit user action on the current tab
- `scripting` so the extension can extract metadata from the active tab
- `storage` so settings and last-used vault are stored locally
- broad host permissions because the prototype must be able to call the configured RefHub API origin at runtime

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

- `src/js/background.js`: background runtime, extraction orchestration, RefHub API calls, vault caching, open-in-app route selection
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
