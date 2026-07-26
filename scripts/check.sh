#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIST="$(mktemp -d "${TMPDIR:-/tmp}/huiyao-check.XXXXXX")"
trap 'rm -rf "$FRONTEND_DIST"' EXIT
cd "$ROOT_DIR"

npm test
npm run build -- --outDir "$FRONTEND_DIST" --emptyOutDir
npm run verify:frontend-dist -- "$FRONTEND_DIST"
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml

MACOS_GLIB_TREE="$(cargo tree --manifest-path src-tauri/Cargo.toml \
  --target aarch64-apple-darwin -i glib 2>/dev/null)"
if [[ -n "$MACOS_GLIB_TREE" ]]; then
  printf '%s\n' "$MACOS_GLIB_TREE" >&2
  echo "glib must not enter the Apple Silicon dependency graph" >&2
  exit 1
fi
