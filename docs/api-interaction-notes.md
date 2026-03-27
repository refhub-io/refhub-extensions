# RefHub Extension API Interaction Notes

## Purpose

This note captures the likely integration boundary between a browser extension and existing RefHub backend capabilities. It is not a final API contract.

## Existing RefHub Signals

- RefHub web app uses Supabase auth for signed-in user sessions.
- RefHub API v1 already separates:
  - management routes authenticated by Supabase session JWT
  - data routes authenticated by RefHub API key
- Data routes already support:
  - list accessible vaults
  - read vault contents
  - add items to a vault

## Existing Useful Endpoints

### Management-authenticated

- `GET /api/v1/keys`
- `POST /api/v1/keys`
- `POST /api/v1/keys/:id/revoke`

### API-key-authenticated

- `GET /api/v1/vaults`
- `GET /api/v1/vaults/:vaultId`
- `POST /api/v1/vaults/:vaultId/items`

### Metadata-related backend behavior already present

- DOI lookup flow in the main app currently falls back:
  - Crossref
  - OpenAlex
  - Semantic Scholar

## Recommended Extension Payload Shape

The extension should normalize capture data before save into a minimal payload aligned with current item creation:

```json
{
  "items": [
    {
      "title": "Example title",
      "authors": ["A. Author"],
      "year": 2026,
      "journal": "Example Journal",
      "doi": "10.1234/example",
      "url": "https://example.org/article",
      "abstract": "Optional abstract",
      "publication_type": "article",
      "pdf_url": "https://example.org/example.pdf"
    }
  ]
}
```

## Gaps To Decide Before Build

1. Whether the extension should call `POST /api/v1/keys` itself after web auth.
2. Whether a dedicated extension token-exchange endpoint is needed instead of exposing API-key creation to extension clients.
3. Whether the backend should expose a purpose-built capture endpoint such as `POST /api/v1/capture/resolve` for DOI/page enrichment and duplicate hints.
4. Whether current `publication_type` values are sufficient for generic webpage capture.

## Suggested Future Extension-Friendly Backend Endpoints

These are optional and should only be built if they simplify product behavior enough to justify them.

### `POST /api/v1/capture/resolve`

Input:

- current URL
- canonical URL
- extracted meta tags
- extracted structured data

Output:

- normalized candidate item
- detected page type
- field provenance
- duplicate hints
- saveability decision

### `POST /api/v1/extension/session`

Purpose:

- exchange a signed-in user session for a browser-extension-scoped credential or managed API key

This could be cleaner than teaching the extension full API-key lifecycle management directly.
