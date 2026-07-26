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
