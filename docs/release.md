# macOS 发布指南

## 构建

版本号需要同时更新 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json`。界面版本直接读取 `package.json`，禁止单独硬编码。

```bash
npm run check
npm audit --omit=dev --registry=https://registry.npmjs.org
cargo audit --file src-tauri/Cargo.lock
npm run build:macos:arm64
```

当前 macOS 预览版使用 `ld64.lld`，并关闭 release strip，具体环境变量已固化在 `scripts/build-macos-arm64.sh`。

仓库内 `dist/` 不可写时，不使用管理员权限覆盖；先修复产物所有权，或使用 `/tmp/huiyao-ui-dist` 等独立可写目录完成前端验证。

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
- `docs/assets/ui/current/` 已覆盖为本版本 1440x900 浅色与 1120x720 深色截图，不包含用户图片或模型正文。

公开分发前必须改用 Apple Developer ID 签名并完成 notarization。
