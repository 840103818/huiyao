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

## 界面验证

优先使用 `browser-skill`，不可用时使用 Playwright。至少覆盖：

- `1440x900` 浅色和深色主题。
- `1120x720` 最小窗口。
- 空状态、流式中间态、完整长结果和错误状态。
- 历史抽屉、右键菜单、设置、日志和图片查看器。

完成修改后运行 `codegraph sync`，不要删除或提交 `.codegraph/codegraph.db`。
