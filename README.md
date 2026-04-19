# refhub-extensions

> // browser_extension for [refhub.io](https://refhub.io)

browser extension for saving papers to refhub directly from any tab. one shared source tree, browser-specific manifests for chrome and firefox.

---

## // what it does

- reads the current tab url on user action
- extracts metadata from the page — canonical url, citation meta tags, json-ld, open graph, document metadata
- shows a popup preview with page type, doi, source, and normalized fields
- lists writable vaults and saves the item via `POST /api/v1/vaults/:vaultId/items`
- detects linked google drive storage and copies the pdf into the managed drive folder when available
- opens the matching refhub route after save — `/public/:slug` for public vaults, `/vault/:id` for private

---

## // build

```sh
npm run build
```

release builds default to production endpoints, locked in the options ui. for local or self-hosted work:

```sh
REFHUB_ALLOW_CUSTOM_URLS=1 \
REFHUB_API_BASE_URL=https://refhub-api.netlify.app \
REFHUB_APP_BASE_URL=https://refhub.io \
npm run build

# or shortcut
npm run build:dev
```

output:

```
dist/chrome
dist/firefox
```

manifest strategy:
- chrome: mv3 `background.service_worker`
- firefox: mv3 `background.scripts` — loads as a temporary add-on without forking runtime code

---

## // install

### store (recommended)

- **chrome / chromium** — [chrome web store](https://chromewebstore.google.com) *(pending approval)*
- **firefox** — [mozilla add-ons](https://addons.mozilla.org) *(pending approval)*

### developer preview

**chrome / chromium**

1. run `npm run build` or download the latest release zip
2. extract to a folder on disk
3. open `chrome://extensions`
4. enable developer mode (top-right toggle)
5. click load unpacked → select `dist/chrome`

**firefox**

1. run `npm run build` or download the latest release zip
2. extract to a folder on disk
3. open `about:debugging#/runtime/this-firefox`
4. click load temporary add-on → select `dist/firefox/manifest.json`

> firefox temporary add-ons are removed on browser restart — preview/testing only.
> do **not** load the release zip directly via "extensions → load from file" — firefox rejects unsigned packages.

see [`docs/RELEASE_NOTES.md`](./docs/RELEASE_NOTES.md) for detailed user-facing install instructions.

---

## // setup

1. sign in to refhub
2. open `refhub.io/profile-edit` → `api_keys` tab
3. create a key with `vaults:read` and `vaults:write`
4. optionally restrict the key to selected vaults
5. open the extension options page and paste the api key
6. open a supported page, click the extension action
7. confirm the preview, choose a vault, click `save_to_refhub`

required scopes: `vaults:read` · `vaults:write`

not required: `vaults:export`

for local or self-hosted testing, build with `REFHUB_ALLOW_CUSTOM_URLS=1` then set:
- `refhub api base url` — backend origin only, no `/api/v1` suffix
- `refhub app url` — frontend origin for post-save links

---

## // permissions

| permission | reason |
|---|---|
| `activeTab` | capture only runs after explicit user action on the current tab |
| `scripting` | extract metadata from the active tab |
| `storage` | persist api key and last-used vault locally |
| host permissions | narrowed to bundled refhub api origin in release builds; broader in dev builds for local override targets |

---

## // supported pages

in scope:
- doi landing pages
- pages with `citation_*` metadata
- pages with article-like json-ld
- generic pages with usable title + url fallback

out of scope:
- direct pdf tabs
- multi-item search / index pages
- background crawling or persistent site access
- full auth / token exchange inside the extension

---

## // architecture

```
src/js/
  background.js   ← extraction orchestration, refhub api calls, vault caching, post-save routing
  popup.js        ← capture preview, vault picker, save flow
  options.js      ← api key config, dev endpoint overrides
scripts/
  build.mjs       ← emits browser-specific manifests from shared source tree
```

capture uses `activeTab` + `scripting.executeScript` — no persistent access to arbitrary sites.

---

## // cross-browser strategy

shared across browsers: popup ui, extraction heuristics, normalization, storage schema, refhub api client.

isolated per browser: manifests, a thin `chrome` vs `browser` api compatibility layer, auth handoff, service worker lifecycle differences.

chrome-first for v1. firefox support is an incremental adapter-and-testing exercise, not a separate implementation.
