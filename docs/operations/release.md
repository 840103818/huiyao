# macOS 发布指南

## 发布前

确认 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 版本一致，工作区不包含凭证、用户数据、日志或安装包。

```bash
npm run check
npm audit --registry=https://registry.npmjs.org
cargo audit --file src-tauri/Cargo.lock
git diff --check
```

## 构建

```bash
npm run package:macos
```

脚本使用 Apple Silicon 目标和 `ld64.lld` 构建，执行 ad-hoc 签名，并将结果复制到：

```text
artifacts/release/绘钥.app
artifacts/release/绘钥_1.0.0_aarch64.dmg
```

`--fast` 仅用于已经完成全量检查后的重复打包：

```bash
npm run package:macos -- --fast
```

## 验证

```bash
npm run verify:release
file artifacts/release/绘钥.app/Contents/MacOS/绘钥
codesign --verify --deep --strict --verbose=2 artifacts/release/绘钥.app
open -n artifacts/release/绘钥.app
hdiutil verify artifacts/release/绘钥_1.0.0_aarch64.dmg
```

验证应用启动不是白屏，图标、版本、Bundle ID、最低系统版本和 arm64 架构正确；检查项目、批量导入、队列暂停恢复、流式生成、预设、筛选、废纸篓、原图、设置、日志和 ZIP 导出。

发布前从功能分支完成验证，由维护者人工合并到 `master`。打包脚本不得自动合并、变基或推送分支。

## 签名说明

当前构建使用 ad-hoc 签名，适合个人或内部使用。公开分发必须改用 Apple Developer ID、启用 Hardened Runtime 并完成 notarization；不能将 ad-hoc 产物描述为已公证版本。
