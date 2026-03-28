# RefHub Browser Extension — Install & Release Notes

## Current status

The RefHub browser extension has been submitted to both the Chrome Web Store and Mozilla Add-ons (AMO) for review. Both builds are ready for early testing.

---

## Install RefHub Extension

### Best path: Browser stores (recommended)

Once review completes, install directly from your browser:

- **Chrome / Chromium**: [Chrome Web Store](https://chromewebstore.google.com) *(review pending)*
- **Firefox**: [Mozilla Add-ons (AMO)](https://addons.mozilla.org) *(review pending)*

### Interim path: Developer preview (while stores approve)

You can load the extension locally for testing. Follow the instructions below for your browser.

**⚠️ Important:** Do **not** try to install the release zip in Firefox via the normal extension install UI. Firefox requires signed extensions for regular installs, and will reject an unsigned release zip as "not verified". Use the temporary add-on method instead.

---

## How to load for testing

### Chrome / Chromium

1. Download the latest release `.zip` from the releases page, or build locally with `npm run build`.
2. Extract the zip to a folder on your computer.
3. Open `chrome://extensions` in your address bar.
4. Turn on **Developer mode** (toggle in the top-right corner).
5. Click **Load unpacked**.
6. Select the extracted `dist/chrome` folder.
7. The extension appears in your toolbar immediately.

**That's it.** Chrome allows unpacked extensions for local testing without any review process.

### Firefox

1. Download the latest release `.zip` from the releases page, or build locally with `npm run build`.
2. Extract the zip to a folder on your computer.
3. Open `about:debugging#/runtime/this-firefox` in your address bar.
4. Click **Load Temporary Add-on...**.
5. Navigate to the extracted folder and select the file `dist/firefox/manifest.json`.
6. The extension appears in your toolbar immediately.

**Important notes:**

- This is a **temporary** install — Firefox removes it every time you close and reopen the browser.
- Use it for testing and early feedback.
- The long-term path for Firefox users is the signed listing on AMO once review completes.

---

## Why Firefox rejects the unsigned zip

Firefox has stricter security requirements than Chrome for extension installations:

- Firefox normally requires all extensions to be signed by Mozilla and reviewed before install.
- A release `.zip` file is a **distribution artifact**, not a signed/verified extension package.
- If you try to install it the normal way (e.g., dragging into Firefox or using the extension UI), Firefox will say **"This add-on could not be installed because it appears to be corrupt."** or **"not verified"**. This is expected behavior, not a bug.
- The **temporary add-on** method (via `about:debugging`) is the proper way to test unsigned code on Firefox before store submission.

---

## What to tell users

Use this messaging in your own docs/announcements:

| Path | When | How |
|------|------|-----|
| **Store install** | After review approves | Install from Chrome Web Store or AMO like any other extension |
| **Developer preview** | Right now, for testing | Follow the browser-specific steps above; extract the zip and load unpacked/temporary |
| **Zip install (Firefox)** | ❌ Not supported | Don't tell users to drag/load the zip normally; use temporary add-on instead |

---

## Getting help

- For Chrome dev install issues: make sure Developer Mode is on and you're selecting the correct `dist/chrome` folder.
- For Firefox dev install issues: use `about:debugging#/runtime/this-firefox` (not the normal add-ons page), and select `manifest.json` inside the extracted folder.
- For feedback on the extension itself: [file an issue on GitHub](https://github.com/refhub-io/refhub-extensions) or contact the team.
