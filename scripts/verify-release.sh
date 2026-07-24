#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
APP_PATH="${1:-${ROOT_DIR}/release/绘钥.app}"
DMG_PATH="${2:-${ROOT_DIR}/release/绘钥_${VERSION}_aarch64.dmg}"

test -d "$APP_PATH"
test -f "$DMG_PATH"

xattr -cr "$APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

test "$(plutil -extract CFBundleIdentifier raw "$APP_PATH/Contents/Info.plist")" = "com.huiyao.studio"
test "$(plutil -extract CFBundleShortVersionString raw "$APP_PATH/Contents/Info.plist")" = "$VERSION"
test "$(plutil -extract CFBundleIconFile raw "$APP_PATH/Contents/Info.plist")" = "icon.icns"
test "$(lipo -archs "$APP_PATH/Contents/MacOS/huiyao")" = "arm64"

hdiutil verify "$DMG_PATH"
printf 'Verified 绘钥 %s (arm64).\n' "$VERSION"
