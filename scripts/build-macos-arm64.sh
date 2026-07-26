#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${CARGO_TARGET_DIR:-${TMPDIR:-/tmp}/huiyao-target-${UID}}"
RUST_TOOLCHAIN_BIN="${HOME}/.rustup/toolchains/stable-aarch64-apple-darwin/bin"
FRONTEND_DIST="$(mktemp -d "${TMPDIR:-/tmp}/huiyao-build.XXXXXX")"
trap 'rm -rf "$FRONTEND_DIST"' EXIT

cd "$ROOT_DIR"

DEFAULT_FEATURES="$({
  cargo metadata --manifest-path src-tauri/Cargo.toml --no-deps --format-version 1
} | node -e '
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const metadata = JSON.parse(input);
    const app = metadata.packages.find((item) => item.name === "huiyao");
    process.stdout.write(JSON.stringify(app?.features?.default ?? []));
  });
')"

if [[ "$DEFAULT_FEATURES" != *'"custom-protocol"'* ]]; then
  printf '错误：生产构建必须默认启用 custom-protocol，否则安装包会白屏。\n' >&2
  exit 1
fi

printf 'Building frontend in %s\n' "$FRONTEND_DIST"
npm run build -- --outDir "$FRONTEND_DIST" --emptyOutDir
npm run verify:frontend-dist -- "$FRONTEND_DIST"

PATH="${RUST_TOOLCHAIN_BIN}:${PATH}" \
CARGO_TARGET_DIR="$TARGET_DIR" \
CARGO_PROFILE_RELEASE_STRIP="${CARGO_PROFILE_RELEASE_STRIP:-none}" \
RUSTFLAGS="${RUSTFLAGS:--C link-arg=-fuse-ld=lld}" \
npm run tauri build -- --target aarch64-apple-darwin --config \
  "{\"build\":{\"beforeBuildCommand\":\"\",\"frontendDist\":\"$FRONTEND_DIST\"}}"

printf 'App: %s\n' "$TARGET_DIR/aarch64-apple-darwin/release/bundle/macos/绘钥.app"
printf 'DMG: %s\n' "$TARGET_DIR/aarch64-apple-darwin/release/bundle/dmg/绘钥_$(node -p "require('./package.json').version")_aarch64.dmg"
