# macOS 发布指南

## 构建

版本号需要同时更新 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json` 和界面版本文本。

```bash
npm run check
npm run build:macos:arm64
```

当前 macOS 预览版使用 `ld64.lld`，并关闭 release strip，具体环境变量已固化在 `scripts/build-macos-arm64.sh`。

## 产物

构建结果位于 `/tmp/huiyao-target/aarch64-apple-darwin/release/bundle/`。需要交付时，将 `.app` 和 `.dmg` 放入本地 `release/`，该目录不会提交到 Git。

## 验证

```bash
npm run verify:release
```

验证内容包括：

- `CFBundleIdentifier` 为 `com.huiyao.studio`。
- 版本号与当前发布版本一致。
- Mach-O 架构为 `arm64`。
- `CFBundleIconFile` 指向 `icon.icns`。
- ad-hoc 或正式签名有效。
- DMG 校验和有效。

公开分发前必须改用 Apple Developer ID 签名并完成 notarization。
