#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${CARGO_TARGET_DIR:-/tmp/huiyao-target}"
RUST_TOOLCHAIN_BIN="${HOME}/.rustup/toolchains/stable-aarch64-apple-darwin/bin"

cd "$ROOT_DIR"

PATH="${RUST_TOOLCHAIN_BIN}:${PATH}" \
CARGO_TARGET_DIR="$TARGET_DIR" \
CARGO_PROFILE_RELEASE_STRIP="${CARGO_PROFILE_RELEASE_STRIP:-none}" \
RUSTFLAGS="${RUSTFLAGS:--C link-arg=-fuse-ld=lld}" \
npm run tauri build -- --target aarch64-apple-darwin

printf 'App: %s\n' "$TARGET_DIR/aarch64-apple-darwin/release/bundle/macos/绘钥.app"
printf 'DMG: %s\n' "$TARGET_DIR/aarch64-apple-darwin/release/bundle/dmg/绘钥_$(node -p "require('./package.json').version")_aarch64.dmg"
