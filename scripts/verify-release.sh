#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
APP_PATH="${1:-${ROOT_DIR}/artifacts/release/绘钥.app}"
DMG_PATH="${2:-${ROOT_DIR}/artifacts/release/绘钥_${VERSION}_aarch64.dmg}"

test -d "$APP_PATH"
test -f "$DMG_PATH"

VERIFY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/huiyao-verify.XXXXXX")"
VERIFY_APP="$VERIFY_DIR/绘钥.app"
trap 'rm -rf "$VERIFY_DIR"' EXIT
ditto --noextattr --noqtn "$APP_PATH" "$VERIFY_APP"
xattr -cr "$VERIFY_APP"
codesign --verify --deep --strict --verbose=2 "$VERIFY_APP"

test "$(plutil -extract CFBundleIdentifier raw "$VERIFY_APP/Contents/Info.plist")" = "com.huiyao.studio"
test "$(plutil -extract CFBundleShortVersionString raw "$VERIFY_APP/Contents/Info.plist")" = "$VERSION"
test "$(plutil -extract CFBundleIconFile raw "$VERIFY_APP/Contents/Info.plist")" = "icon.icns"
test "$(plutil -extract CFBundleDevelopmentRegion raw "$VERIFY_APP/Contents/Info.plist")" = "zh_CN"
test "$(plutil -extract CFBundleLocalizations.0 raw "$VERIFY_APP/Contents/Info.plist")" = "zh-Hans"
test "$(lipo -archs "$VERIFY_APP/Contents/MacOS/huiyao")" = "arm64"

hdiutil verify "$DMG_PATH"
printf 'Verified 绘钥 %s (arm64).\n' "$VERSION"
