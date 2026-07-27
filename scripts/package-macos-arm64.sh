#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${CARGO_TARGET_DIR:-${TMPDIR:-/tmp}/huiyao-target-${UID}}"
TARGET_TRIPLE="aarch64-apple-darwin"
FAST_MODE=false

usage() {
  cat <<'EOF'
用法：
  npm run package:macos
  npm run package:macos -- --fast

选项：
  --fast    跳过 npm run check，直接构建并验证产物
  -h, --help
            显示帮助信息
EOF
}

fail() {
  printf '错误：%s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令 $1。请先安装后重试。"
}

for argument in "$@"; do
  case "$argument" in
    --fast) FAST_MODE=true ;;
    -h|--help) usage; exit 0 ;;
    *) printf '错误：未知参数 %s\n\n' "$argument" >&2; usage >&2; exit 2 ;;
  esac
done

trap 'status=$?; printf "打包失败（退出码 %d，脚本第 %d 行）。\n" "$status" "$LINENO" >&2; exit "$status"' ERR

[[ "$(uname -s)" == "Darwin" ]] || fail "该脚本只能在 macOS 上运行。"
[[ "$(uname -m)" == "arm64" ]] || fail "当前机器不是 Apple Silicon，无法构建 arm64 安装包。"

for command in node npm rustup cargo rustc ld64.lld ditto xattr codesign plutil lipo hdiutil; do
  require_command "$command"
done

cd "$ROOT_DIR"
RUST_TOOLCHAIN_BIN="${HOME}/.rustup/toolchains/stable-aarch64-apple-darwin/bin"
[[ -x "$RUST_TOOLCHAIN_BIN/rustc" ]] \
  || fail "未找到 rustup stable 工具链，请先运行 rustup toolchain install stable。"
HUIYAO_RUSTC="$RUST_TOOLCHAIN_BIN/rustc" "$ROOT_DIR/scripts/verify-rust-toolchain.sh"

if [[ ! -x "node_modules/.bin/tauri" ]]; then
  printf '\n==> 未检测到项目依赖，正在执行 npm ci\n'
  npm ci
fi

[[ -x "node_modules/.bin/tauri" ]] || fail "Tauri CLI 不可用，请检查 npm ci 输出。"
rustup target list --toolchain stable --installed | grep -qx "$TARGET_TRIPLE" \
  || fail "缺少 Rust 目标 $TARGET_TRIPLE，请先运行 rustup target add $TARGET_TRIPLE。"

VERSION="$(node -p "require('./package.json').version")"
BUILD_ROOT="$TARGET_DIR/$TARGET_TRIPLE/release/bundle"
BUILD_APP="$BUILD_ROOT/macos/绘钥.app"
BUILD_DMG="$BUILD_ROOT/dmg/绘钥_${VERSION}_aarch64.dmg"
RELEASE_DIR="$ROOT_DIR/artifacts/release"
RELEASE_APP="$RELEASE_DIR/绘钥.app"
RELEASE_DMG="$RELEASE_DIR/绘钥_${VERSION}_aarch64.dmg"

printf '\n==> 绘钥 %s Apple Silicon 生产打包\n' "$VERSION"
if [[ "$FAST_MODE" == true ]]; then
  printf '==> 快速模式：跳过完整测试\n'
else
  printf '==> 运行完整检查\n'
  npm run check
fi

printf '\n==> 构建 App 与 DMG\n'
CARGO_TARGET_DIR="$TARGET_DIR" npm run build:macos:arm64

[[ -d "$BUILD_APP" ]] || fail "未找到构建产物：$BUILD_APP"
[[ -f "$BUILD_DMG" ]] || fail "未找到构建产物：$BUILD_DMG"

printf '\n==> 复制产物到 artifacts/release\n'
mkdir -p "$RELEASE_DIR"
rm -rf "$RELEASE_APP"
rm -f "$RELEASE_DMG"
ditto --noextattr --noqtn "$BUILD_APP" "$RELEASE_APP"
ditto --noextattr --noqtn "$BUILD_DMG" "$RELEASE_DMG"

printf '\n==> 验证产物\n'
npm run verify:release -- "$RELEASE_APP" "$RELEASE_DMG"

printf '\n打包完成。\nApp: %s\nDMG: %s\n' "$RELEASE_APP" "$RELEASE_DMG"
