# macOS 发布指南

## 发布前

确认 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 版本一致，工作区不包含凭证、用户数据、日志或安装包。

```bash
npm run check
npm audit --registry=https://registry.npmjs.org
cargo audit --file src-tauri/Cargo.lock
git diff --check
codegraph sync
```

同时确认：

- `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 版本完全一致。
- `CHANGELOG.md` 已包含当天版本说明，README 和文档中心指向当前功能。
- 功能分支已经完成验证并明确合并到本地 `master`；`master` 与远端不存在未处理分叉。
- 发布标签不存在，`artifacts/release/` 中没有被误提交的旧产物。

## 构建

```bash
npm run package:macos
```

脚本使用官方 `rustup stable` 的 Rust 1.95 或以上工具链、Apple Silicon 目标和 `ld64.lld` 构建，执行 ad-hoc 签名，并将结果复制到：

```text
artifacts/release/绘钥.app
artifacts/release/绘钥_2.0.0_aarch64.dmg
```

`--fast` 仅用于已经完成全量检查后的重复打包：

```bash
npm run package:macos -- --fast
```

## 验证

```bash
npm run verify:release
file artifacts/release/绘钥.app/Contents/MacOS/huiyao
codesign --verify --deep --strict --verbose=2 artifacts/release/绘钥.app
open -n artifacts/release/绘钥.app
hdiutil verify artifacts/release/绘钥_2.0.0_aarch64.dmg
```

验证应用启动不是白屏，图标、版本、Bundle ID、最低系统版本和 arm64 架构正确；确认 `CFBundleDevelopmentRegion=zh_CN`、`CFBundleLocalizations` 包含 `zh-Hans`，WebKit 原生恢复按钮显示“重新载入”；检查项目、批量导入、队列暂停恢复、流式生成、统一修订、字段锁定、AI 重测、提示词同步、比较、预设、筛选、废纸篓、原图、设置、日志和 ZIP 导出。

发布前从功能分支完成验证，由维护者人工合并到 `master`。打包脚本不得自动合并、变基或推送分支。

## 标签与 GitHub Release

仅在 `master` 的提交、安装包和版本校验均通过后创建带注释标签：

```bash
git tag -a v2.0.0 -m "绘钥 2.0.0"
git push origin master
git push origin v2.0.0
```

使用 GitHub CLI 发布，并将 CHANGELOG 中当前版本内容作为发布说明：

```bash
gh release create v2.0.0 \
  artifacts/release/绘钥_2.0.0_aarch64.dmg \
  --title "绘钥 2.0.0" \
  --notes-file artifacts/release/RELEASE_NOTES.md
```

发布后核对标签目标提交、DMG 文件名和大小、下载可用性及 Release 是否为正式版本。不要上传未签名的中间产物、用户数据、日志或诊断文件。

## 签名说明

当前构建使用 ad-hoc 签名，适合个人或内部使用。公开分发必须改用 Apple Developer ID、启用 Hardened Runtime 并完成 notarization；不能将 ad-hoc 产物描述为已公证版本。
