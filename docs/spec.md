# RefHub Browser Extension Spec

## 1. Goals

### Goals

- Let a signed-in RefHub user capture the current browser tab and add it to a chosen RefHub vault.
- Keep v1 narrow: one-page capture, one save action, one selected vault, minimal post-processing.
- Extract enough metadata from the current page and URL to create a useful RefHub item without forcing manual entry for common academic pages.
- Reuse existing RefHub concepts: vault-centric permissions, API-first backend, auth-aware flows, and lean write operations.
- Support a Zotero-like "save this page/paper" interaction, but with RefHub's vault model instead of a local library.

### Non-goals

- Full Zotero parity.
- A general-purpose web clipper with article snapshotting, annotation, highlighting, or offline archival.
- Bulk tab capture, reading-list sync, PDF full-text ingestion, or background library deduplication in v1.
- Browser-side crawling beyond the current tab and its directly available metadata.
- Complex metadata correction UI before save.
- Automatic tag creation, relation inference, or citation graph building during initial capture.

## 2. Core User Flows

### Flow A: Save current tab to a vault

1. User opens a supported page in the browser.
2. User clicks the RefHub extension action.
3. Popup shows:
   - detected page type
   - title / authors / source preview
   - target vault selector
   - save button
4. User chooses a vault if needed.
5. Extension saves the item into RefHub.
6. Popup confirms success and links to the saved vault item or vault.

### Flow B: First-time sign-in

1. User opens the extension while signed out.
2. Popup explains sign-in is required.
3. User is sent to RefHub auth in a web tab/window.
4. After auth completes, extension receives or restores session state.
5. User returns to the popup and saves the current page.

### Flow C: Unsupported or weakly structured page

1. User opens the extension on a page with sparse metadata.
2. Extension still parses URL and page metadata.
3. Popup shows a reduced-confidence preview.
4. User can still save if minimum required fields are present, or sees a clear unsupported-state message if not.

### Flow D: Session expired during save

1. User clicks save.
2. Backend call returns auth failure.
3. Popup preserves extracted draft metadata.
4. User re-authenticates and retries save without re-running extraction if possible.

## 3. Supported Page / Source Types for V1

V1 should optimize for pages where URL + in-page metadata usually yield a citation-quality record.

### Supported in v1

- DOI landing pages from publisher sites
- Article abstract/landing pages on journal and conference sites
- Preprint pages such as arXiv and bioRxiv-style landing pages
- Pages exposing citation metadata via `citation_*` meta tags
- Pages exposing Schema.org metadata for scholarly works
- Generic web pages with strong Open Graph or document metadata, saved as a lower-fidelity web reference

### Explicit v1 exclusions

- Direct PDF capture as a first-class flow
- Multi-item detection on index/search result pages
- Saving from browser selection or context-menu snippet capture
- Auth-walled sites that hide metadata from the DOM
- Browser history import or bookmark import
- Full-page snapshots / archive copies

## 4. Extraction / Parsing Pipeline for Current Tab URL

The extension should treat extraction as a staged pipeline with confidence scoring and deterministic fallback.

### Stage 0: Acquire tab context

- Read current tab URL, title, and top-level page HTML context available through a content script.
- Normalize the canonical candidate URL:
  - prefer `<link rel="canonical">`
  - otherwise use current top-level URL after removing obvious tracking params
- Capture page language and hostname for heuristics.

### Stage 1: Detect page type

Classify current page into one of:

- `doi-landing`
- `scholarly-article`
- `preprint`
- `generic-webpage`
- `unsupported`

Signals:

- DOI present in URL, canonical URL, or page metadata
- scholarly `citation_*` meta tags
- Schema.org `ScholarlyArticle` / related structured data
- known scholarly host heuristics
- generic Open Graph / document metadata only

### Stage 2: Extract raw metadata candidates

Collect all candidate fields from:

- current URL
- canonical URL
- page title
- meta tags
- JSON-LD / Microdata
- DOI-derived remote lookup if DOI found
- optional backend enrichment for known scholarly identifiers

### Stage 3: Normalize fields

Normalize into a RefHub capture payload:

- `title`
- `authors[]`
- `year`
- `journal` or source / venue
- `doi`
- `url`
- `abstract`
- `publication_type`
- `pdf_url` if confidently available
- capture diagnostics:
  - `page_type`
  - `source_hostname`
  - `confidence`
  - `metadata_sources[]`

### Stage 4: Confidence and save eligibility

V1 minimum saveability:

- For scholarly item: `title` plus at least one of `doi`, `authors`, `journal`, `year`, or supported scholarly page classification
- For generic web reference: `title` and `url`

If minimum is not met, extension should block save and explain why.

## 5. Metadata Sources and Fallback Order

V1 should use a strict precedence order to avoid merging low-quality fields over stronger ones.

### Preferred field sources

1. DOI lookup result when a trusted DOI is found
2. Page-level scholarly metadata:
   - `citation_title`
   - `citation_author`
   - `citation_publication_date`
   - `citation_journal_title`
   - `citation_doi`
   - related scholarly meta tags
3. Schema.org / JSON-LD:
   - `ScholarlyArticle`
   - `Article`
   - `CreativeWork`
4. Canonical URL + page title heuristics
5. Open Graph / Twitter card metadata
6. Browser tab title and raw URL fallback

### DOI enrichment order

When a DOI is detected, server-side or extension-mediated lookup should follow existing RefHub direction where practical:

1. Crossref
2. OpenAlex
3. Semantic Scholar

This matches existing RefHub DOI fallback behavior in the main app and keeps extension metadata handling aligned with current product logic.

### Merge rules

- DOI-derived identifiers override page-derived DOI candidates.
- Canonical URL overrides raw tab URL for saved `url` when present and sane.
- Prefer author arrays from scholarly metadata over Open Graph single-string author values.
- Prefer venue/journal from DOI or scholarly metadata over hostname inference.
- Never overwrite a non-empty high-confidence field with a lower-confidence fallback.
- Preserve provenance per field where feasible for debugging.

## 6. Auth Model with RefHub

### Recommended v1 model

Use RefHub user authentication for sign-in, then mint or use a RefHub API key dedicated to the extension for vault read/write calls.

Reasoning:

- Existing RefHub already separates management routes from data routes.
- Vault reads and writes already have an API-key contract.
- The extension should not call Supabase tables directly from browser extension code.
- A dedicated extension key keeps backend contracts narrower and closer to future integrations.

### Proposed auth sequence

1. User signs into RefHub via standard web auth flow.
2. Extension obtains a RefHub-authenticated user session for management actions.
3. Extension creates or retrieves a restricted API key with:
   - `vaults:read`
   - `vaults:write`
4. Extension stores the API key in browser extension local storage with platform-appropriate protections.
5. Popup uses the API key for vault listing and item creation.

### Important ambiguity

The current product exposes API-key management in the main app, but it is not yet defined whether the extension should:

- create its own key automatically after user consent
- require the backend to expose an OAuth-like extension token exchange
- or rely on direct user session JWT calls for v1

This must remain an open product/API decision, not an implementation guess.

## 7. Vault Selection UX and Save Flow

### Popup UX for v1

- Compact popup focused on one action.
- Sections:
  - capture preview
  - vault selector
  - save status / errors

### Vault selection behavior

- Show recent or last-used vault first.
- Provide searchable vault picker if user has many vaults.
- Persist last-selected vault locally.
- Only list vaults where user has write-capable permission for this flow.

### Save flow

1. User opens popup.
2. Extension extracts metadata immediately.
3. Popup renders preview with loading state while enrichment completes.
4. User confirms target vault.
5. Extension posts one item to RefHub.
6. Popup returns:
   - success confirmation
   - vault name
   - optional open-in-RefHub link

### V1 save payload principles

- Single-item save only
- Minimal editable surface in popup
- No tag assignment unless tags are already easy to fetch and select without UX bloat
- Duplicate detection should be advisory, not block save, unless backend already enforces stronger behavior

## 8. Permissions Model for Browser Extension

V1 should request the smallest practical set.

### Required extension permissions

- `activeTab`
- `storage`
- `scripting`

### Host permissions strategy

Recommended:

- avoid broad always-on host permissions in v1
- use `activeTab` plus injected content script on user action

This keeps the trust model narrow and closer to "capture only the page I clicked on."

### Optional permissions

- identity/auth-related permission if browser-specific auth handoff requires it
- limited backend origin permission for RefHub API requests

### Avoid in v1

- persistent access to all sites without user action
- downloads, history, bookmarks, tabs enumeration beyond the current active tab

## 9. Architecture

### Components

- `popup`
  - user-facing capture UI
  - triggers extraction
  - displays vault picker and save states
- `content script`
  - reads DOM metadata from the current page
  - extracts meta tags, JSON-LD, canonical URL, and structured signals
- `background/service worker`
  - owns auth/session state
  - performs RefHub API requests
  - caches recent vault list and last-selected vault
  - mediates popup/content-script communication
- `options` page
  - account status
  - sign-in / sign-out
  - extension preferences
  - debug / diagnostics only if needed
- `RefHub backend`
  - auth/session handling
  - API-key management or extension-token issuance
  - vault listing and item creation endpoints
  - metadata enrichment endpoint if browser-only extraction is insufficient

### Interaction model

1. Popup requests current-tab extraction.
2. Background injects or contacts content script.
3. Content script returns raw page metadata.
4. Background normalizes data and optionally calls backend enrichment.
5. Popup renders preview.
6. User saves.
7. Background writes via RefHub API and returns result.

### Suggested backend interaction boundary

Keep site-specific enrichment and DOI/provider lookups server-capable where possible. Browser extension logic should prefer extraction + normalization, not long-term maintenance of many third-party provider integrations inside the extension bundle.

## 10. Manifest Choice and Browser Support Strategy

### Manifest

Use Manifest V3 as the default baseline.

Reasoning:

- current Chrome extension ecosystem requires MV3
- service-worker background model is the modern path
- keeps the initial architecture aligned with current browser store expectations

### Browser support strategy

V1 target:

- Chromium browsers first:
  - Chrome
  - Edge
  - Brave

V1.5 or v2:

- Firefox support after validating:
  - MV3 feature parity
  - auth handoff behavior
  - service worker lifecycle differences

Safari should be explicitly out of scope for v1 unless there is a strong product requirement.

## 11. Error States and Recovery

### Key user-visible errors

- not signed in
- session expired
- no writable vaults available
- unsupported page type
- metadata extraction too weak to save
- backend/API unavailable
- save rejected by permission policy
- duplicate or possible duplicate detected

### Recovery rules

- Preserve extracted draft state while popup remains open.
- Offer retry for transient network/backend failures.
- For auth failures, redirect to sign-in and retry save after return.
- For unsupported pages, explain what signals were missing.
- For restricted vault access, let user choose another writable vault.

## 12. Privacy and Security Considerations

- Capture only on explicit user action.
- Do not scrape background tabs.
- Do not transmit full page HTML by default if extracted structured metadata is enough.
- Minimize stored local data:
  - auth material
  - last-selected vault
  - short-lived extraction cache
- Treat API keys as secrets and scope them narrowly.
- Avoid logging captured page metadata unless debug mode is enabled.
- Clearly disclose what is sent to RefHub:
  - URL
  - extracted metadata
  - chosen vault
- If backend enrichment is used, document which third-party metadata providers may be queried server-side.

## 13. Phased Roadmap

### V1

- Save current tab into a selected vault
- Sign-in flow
- Vault selection
- DOI / scholarly metadata extraction
- Generic webpage fallback
- Single-item create API call
- Clear error and retry states

### V2

- Better duplicate detection and merge guidance
- Page-type-specific heuristics for more scholarly hosts
- Direct PDF-page handling
- Manual metadata correction before save
- Tag selection during save
- Context menu entry
- Better success deep-links into the created item

### V3

- Multi-item detection on search/index pages
- Save to multiple vaults
- Snapshot / archive integrations if product direction supports it
- Full extension settings and debug tools
- Organization/workspace-aware capture flows if RefHub adds them

## 14. Open Questions for Velitchko

These are the main product ambiguities that should be decided before implementation.

1. Should the extension save through a dedicated backend extension flow, or should it mint and use a RefHub API key under the user account?
2. If API keys are used, should the extension auto-create a hidden "RefHub Browser Extension" key, or require explicit user review/consent for key creation?
3. Is generic webpage capture in scope for v1, or should v1 accept only scholarly pages with citation-quality metadata?
4. Should v1 create a normal publication item for generic webpages, or does RefHub need a separate source/reference type first?
5. What is the desired duplicate policy when the same DOI or title already exists in the target vault?
6. Should the extension allow saving into any writable vault, or only a user-configured subset?
7. Is tag assignment intentionally out of scope for v1, or should recently used tags be selectable at save time?
8. Should backend enrichment be allowed to query third-party providers beyond current DOI flow, or should v1 stay browser-only except for RefHub save calls?
9. Does RefHub want browser-extension auth to be Supabase-session-based in v1 for speed, even if that is not the long-term integration model?
10. Is Firefox support expected in the first release, or is Chromium-first explicitly acceptable?
11. Should direct PDF tabs be treated as unsupported in v1, or saved as URL-only web references?
12. What should success link to: the vault, the created item, or a pending review screen in RefHub?

## Recommended V1 Decision Summary

If fast execution is the priority, the leanest defensible v1 is:

- Chromium-first MV3 extension
- popup + content script + background worker architecture
- explicit user-triggered current-tab capture only
- DOI / scholarly metadata extraction plus generic page fallback
- single selected vault save
- no snapshots, no tags, no multi-item capture
- reuse existing RefHub vault write API shape where possible

That keeps v1 small enough to ship while leaving the larger auth and capture-scope questions visible instead of buried in implementation.
