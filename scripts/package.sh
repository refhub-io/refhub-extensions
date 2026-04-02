#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

# Read version from package.json
VERSION=$(node -p "require('$ROOT_DIR/package.json').version" 2>/dev/null || echo "0.0.0")

# --local  →  point at http://localhost:8888 (dev backend)
LOCAL=0
for arg in "$@"; do [[ "$arg" == "--local" ]] && LOCAL=1; done

if [[ $LOCAL -eq 1 ]]; then
  export REFHUB_API_BASE_URL="http://localhost:8888"
  export REFHUB_ALLOW_CUSTOM_URLS="1"
  ZIP_SUFFIX="-local"
else
  ZIP_SUFFIX=""
fi

CHROME_ZIP="$ROOT_DIR/refhub-chrome-$VERSION${ZIP_SUFFIX}.zip"
FIREFOX_ZIP="$ROOT_DIR/refhub-firefox-$VERSION${ZIP_SUFFIX}.zip"

# ── helpers ──────────────────────────────────────────────────────────────────

info()    { printf '\033[1;34m==> \033[0m%s\n' "$*"; }
success() { printf '\033[1;32m✓ \033[0m%s\n' "$*"; }
die()     { printf '\033[1;31mERROR: \033[0m%s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "node is required but not found"
command -v zip  >/dev/null 2>&1 || die "zip is required but not found"

make_zip() {
  local archive="$1" src_dir="$2"
  (cd "$src_dir" && zip -r --quiet "$archive" .)
}

# ── build ─────────────────────────────────────────────────────────────────────

API_TARGET="${REFHUB_API_BASE_URL:-https://refhub-api.netlify.app}"
info "Building extension (v$VERSION) → $API_TARGET"
cd "$ROOT_DIR"
node scripts/build.mjs

[[ -d "$DIST_DIR/chrome"  ]] || die "Chrome dist missing: $DIST_DIR/chrome"
[[ -d "$DIST_DIR/firefox" ]] || die "Firefox dist missing: $DIST_DIR/firefox"

# ── zip chrome ────────────────────────────────────────────────────────────────

info "Packaging Chrome → $(basename "$CHROME_ZIP")"
rm -f "$CHROME_ZIP"
make_zip "$CHROME_ZIP" "$DIST_DIR/chrome"
success "$(basename "$CHROME_ZIP")  ($(du -sh "$CHROME_ZIP" | cut -f1))"

# ── zip firefox ───────────────────────────────────────────────────────────────

info "Packaging Firefox → $(basename "$FIREFOX_ZIP")"
rm -f "$FIREFOX_ZIP"
make_zip "$FIREFOX_ZIP" "$DIST_DIR/firefox"
success "$(basename "$FIREFOX_ZIP")  ($(du -sh "$FIREFOX_ZIP" | cut -f1))"

# ── done ──────────────────────────────────────────────────────────────────────

printf '\n\033[1mDone.\033[0m Packages written to:\n'
printf '  %s\n' "$CHROME_ZIP"
printf '  %s\n' "$FIREFOX_ZIP"
