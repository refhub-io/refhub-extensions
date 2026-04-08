# RefHub Browser Extension Prototype

This repo contains the first working RefHub browser extension prototype described in [`docs/spec.md`](/opt/openclaw/projects/r2d2/refhub-extensions/docs/spec.md). It keeps scope narrow, uses one shared source tree, and now emits browser-specific manifests so both Chrome and Firefox builds are loadable from the same codebase.

## What the prototype does

- reads the current tab URL on user action
- extracts a small metadata bundle from the page using canonical URL, citation meta tags, JSON-LD, Open Graph, and document metadata
- shows a popup preview with page type, DOI, source, and normalized item fields
- lets the user configure a RefHub API key
- lists writable vaults from RefHub and saves a single item with `POST /api/v1/vaults/:vaultId/items`
- detects whether the RefHub account behind the configured API key has linked Google Drive storage
- when Drive storage is linked and a `pdf_url` is available, asks the backend to copy the PDF into the managed Drive folder during save
- opens the matching RefHub route after save: `/public/:slug` for public vaults, `/vault/:id` for private or shared vaults
- reports clear setup, extraction, auth, and save errors

## Build

```bash
npm run build
```

Release builds now default to production RefHub endpoints and keep them locked in the options UI. For local or self-hosted work, use the dev build path.

Optional dev build-time overrides:

```bash
REFHUB_ALLOW_CUSTOM_URLS=1 \
REFHUB_API_BASE_URL=https://refhub-api.netlify.app \
REFHUB_APP_BASE_URL=https://refhub.io \
npm run build
```

Shortcut:

```bash
npm run build:dev
```

Build output:

- `dist/chrome`
- `dist/firefox`

Manifest strategy:

- Chrome build keeps MV3 `background.service_worker`
- Firefox build swaps to MV3 `background.scripts` so it loads as a temporary add-on in Firefox without forking the runtime code

Branding:

- extension icons are derived from the existing RefHub favicon asset, reused as the cleanest available project-owned identity mark for now

## Install

### For normal users (recommended)

Once review completes, install from your browser store:

- **Chrome / Chromium**: [Chrome Web Store](https://chromewebstore.google.com) (pending approval)
- **Firefox**: [Mozilla Add-ons / AMO](https://addons.mozilla.org) (pending approval)

### For early testers / developer preview

Until store listings are approved, you can load the extension locally for testing.

**Important:** Do **not** try to load the release zip directly in Firefox via "Extensions → Load From File". Firefox will reject unsigned packages as unverified. Use the temporary add-on method below instead.

See also: [`docs/RELEASE_NOTES.md`](./docs/RELEASE_NOTES.md) for detailed user-facing install instructions.

#### Chrome / Chromium

1. Download the latest release or run `npm run build`.
2. Extract the zip so you have a folder on disk.
3. Open `chrome://extensions`.
4. Enable **Developer Mode** (toggle in the top-right).
5. Click **Load unpacked**.
6. Select the extracted `dist/chrome` folder.

#### Firefox

1. Download the latest release or run `npm run build`.
2. Extract the zip so you have a folder on disk.
3. Open `about:debugging#/runtime/this-firefox`.
4. Click **Load Temporary Add-on...**.
5. Select `dist/firefox/manifest.json` from the extracted folder.

**Note:** Firefox temporary add-ons are removed on browser restart. This is for preview/testing only, not the long-term user install path.

## Configure and test

1. Sign in to RefHub web app.
2. Open `https://refhub.io/profile-edit`.
3. Switch to the `api_keys` tab.
4. Create a key with `vaults:read` and `vaults:write`.
5. Optionally restrict the key to selected vaults for least-privilege access.
6. Open the extension options page.
7. Paste the API key.
8. Open a supported page and click the extension action.
9. Confirm the preview, choose a writable vault, and click `save_to_refhub`.

For local or self-hosted testing, build with `REFHUB_ALLOW_CUSTOM_URLS=1` and then set:

- `RefHub API base URL` to the backend origin only. Do not append `/api/v1`.
- `RefHub app URL` to the frontend origin used for post-save links.

Important setup details:

- Release builds already bundle the production RefHub API and app URLs.
- Current frontend key-creation path is `/profile-edit` → `api_keys`.
- Current Google Drive link path is `/profile-edit` → `storage`.
- The extension only surfaces writable vaults (`owner` or `editor` access).

Required API-key scopes:

- `vaults:read` to list accessible vaults
- `vaults:write` to create items in the selected vault

Not required for this extension:

- `vaults:export`

Extension permissions and why they exist:

- `activeTab` so capture only runs after explicit user action on the current tab
- `scripting` so the extension can extract metadata from the active tab
- `storage` so API key and last-used vault are stored locally
- production host permissions are narrowed to the bundled RefHub API origin
- dev builds keep broader host access so local override targets still work

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
- `src/js/options.js`: API key configuration plus dev-only endpoint overrides
- `scripts/build.mjs`: emits browser-specific manifests from one shared source tree

The prototype uses `activeTab` + `scripting.executeScript` so capture only happens after explicit user action. It does not keep persistent access to arbitrary sites.

## Cross-browser strategy

Zotero’s connector architecture is a useful concept reference here: keep the extraction and product logic shared, and isolate browser runtime differences in a thin adapter/build layer instead of forking the whole runtime code. We can follow that same general approach without borrowing code.

Practical same-codebase strategy for RefHub:

- share popup UI, extraction heuristics, normalization, storage schema, and RefHub API client logic
- generate per-browser manifests and keep a small runtime compatibility layer for `chrome` vs `browser` APIs
- expect browser-specific handling around auth handoff, service worker lifecycle differences, and any APIs that are still uneven in Firefox MV3
- keep capture initiated by user action with `activeTab` semantics in both browsers

Conclusion: same-codebase multi-browser builds are realistic for this extension. Chrome-first is sensible for v1, and Firefox support should be an incremental adapter-and-testing exercise rather than a separate implementation.
