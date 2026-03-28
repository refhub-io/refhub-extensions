# Release Notes

## Current release status

The RefHub browser extension has been packaged for both Chrome and Firefox and submitted for store review.

### Store install (recommended)

For normal users, the supported install path is the browser store listing once review completes:

- **Chrome / Chromium**: Chrome Web Store
- **Firefox**: Mozilla Add-ons (AMO)

Until those listings are approved, prefer the developer-preview instructions below.

## Developer preview install

### Chrome / Chromium

Chrome expects an unpacked extension folder for local testing.

1. Download the current release asset or build locally.
2. Extract the archive so you have a normal folder on disk.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted `dist/chrome` folder.

### Firefox

Firefox does **not** support normal-user installation from an arbitrary unsigned zip file.

If you try **Extensions → Load From File** with an unsigned package, Firefox may reject it as unverified. That is expected.

For testing before AMO approval, use a temporary developer install instead:

1. Download the current release asset or build locally.
2. Extract the archive so you have a normal folder on disk.
3. Open `about:debugging#/runtime/this-firefox`.
4. Click **Load Temporary Add-on...**.
5. Select `dist/firefox/manifest.json` from the extracted folder.

Notes:

- this is a **temporary** install
- Firefox removes it on browser restart
- this is for preview/testing, not the long-term user install path

## Why the zip may fail in Firefox

A release zip is a distribution artifact, not automatically a user-installable Firefox extension package.

For ordinary Firefox users, the correct long-term path is the AMO-reviewed listing. Until then, use the temporary add-on flow described above.

## Recommended user-facing wording

Use this framing in announcements and docs:

- **Stable install**: available via browser stores once review is approved
- **Early preview**: available via developer install from extracted build folders
- **Firefox zip install**: not supported as a normal-user flow before signing/store approval
