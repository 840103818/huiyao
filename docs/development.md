# 开发指南

## 环境

- macOS 12+
- Node.js 20.19+，推荐使用 `.nvmrc` 中的版本
- npm 10+
- Rust stable 与 Xcode Command Line Tools

```bash
nvm use
npm ci
npm run dev:desktop
```

## 检查

```bash
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
```

`npm run check` 会按顺序执行以上检查。Cargo 全局缓存出现权限警告时，只要编译和测试最终退出码为 0，不影响项目结果。

Vite 配置只保留 `vite.config.ts`。不要生成同名的 `vite.config.js`，否则 Vite 会优先读取旧的 JavaScript 配置并绕过当前分包和安全构建设置。

## 安全审计

```bash
npm audit --omit=dev --registry=https://registry.npmjs.org
cargo audit --file src-tauri/Cargo.lock
```

`cargo audit` 扫描完整跨平台锁文件时可能列出 Tauri Linux GTK 依赖的维护状态警告；macOS 发布目标不包含这些 crate。仍需确认没有 `vulnerability`，并在依赖升级后重新审查这些提示。

## 界面验证

优先使用 `browser-skill`，不可用时使用 Playwright。至少覆盖：

- `1440x900` 浅色和深色主题。
- `1120x720` 最小窗口。
- 空状态、流式中间态、完整长结果和错误状态。
- 历史抽屉、右键菜单、设置、日志和图片查看器。
- 剪贴板图片导入、EXIF 缺失/存在、手工版本保存失败和版本比较复制。

完成修改后运行 `codegraph sync`，不要删除或提交 `.codegraph/codegraph.db`。

## 文档与截图同步

- 每次代码修改必须同步核对 `README.md` 的用户操作说明和 `docs/architecture.md` 的技术说明；行为、接口或发布方式变化时更新对应文档。
- 页面布局或视觉样式修改后，覆盖更新 `docs/assets/ui/current/` 中的最新截图。
- 固定至少保留 `workspace-light-1440x900.png`、`workspace-dark-1120x720.png`、`visual-input-drawer-light-1440x900.png` 和 `visual-input-drag-dark-1120x720.png`。
- 截图前检查无横向溢出、遮挡、文字截断和弹层越界；截图只保存测试数据，不包含 API Key、提示词正文、用户原图或其他敏感信息。
