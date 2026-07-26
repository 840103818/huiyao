# 开发指南

## 环境

- Apple Silicon Mac，macOS 12 或以上。
- Node.js `>=20.19.0`，npm `>=10`。
- Rust stable、`aarch64-apple-darwin` 目标和 `rustfmt`。
- 生产打包需要 `ld64.lld`、Xcode Command Line Tools 和 Tauri 系统依赖。

```bash
npm ci
rustup target add aarch64-apple-darwin
rustup component add rustfmt
```

## 启动

```bash
npm run dev:desktop  # 完整桌面能力
npm run dev          # 仅调试前端
```

Vite 固定使用 `127.0.0.1:1420`。配置只来自 `vite.config.ts`，不要创建会遮蔽它的 `vite.config.js`。

## 开发流程

1. 检查 `git status`，记录并保留已有未提交修改；从当前稳定基线建立独立功能分支。
2. 阅读对应产品、设计和工程文档。
3. 存在 `.codegraph/` 时运行 `codegraph explore "问题或符号"`。
4. 按功能目录修改代码并补充共置测试。
5. 同步操作说明、技术说明；页面变更同步视觉基线。
6. 运行 `npm run check`、`git diff --check` 和 `codegraph sync`。
7. 不自动合并 `master`；向维护者提交分支名、测试结果和人工合并提示。

## 工作区数据库调试

- 数据库位于 Tauri 应用私有目录，文件名为 `workspace.sqlite3`。
- 调试数据库不得读取或输出提示词正文、缩略图、EXIF 或用户文件名。
- Schema 修改集中在 `infrastructure/persistence/workspace.rs`，必须保持幂等并增加旧数据库测试。
- 应用启动会把活动任务改为暂停。测试队列恢复时必须由用户动作继续。

## Mock 与针对性测试

```bash
npm test -- src/features/prompts/PromptPanel.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml api::tests -- --nocapture
```

HTTP 测试使用本地 Mock 服务，不接触真实 API Key。浏览器验证优先使用 `browser-skill`，测试数据不得包含用户图片或模型正文。

## 目录约定

- 功能组件、Hook、工具和测试放入同一 `features/<name>/`。
- 跨功能数据进入 `shared/contracts/`；不要建立宽泛 barrel。
- 组件只能通过 `infrastructure/tauri/` 调用桌面能力。
- Rust 命令只适配参数；业务逻辑进入 `application/`，外部能力进入 `infrastructure/`。
- 构建和视觉产物统一放入 `artifacts/`。

## CodeGraph

仓库已存在 `.codegraph/`，可直接探索和同步；禁止在未初始化仓库中擅自初始化。目录移动完成后必须运行 `codegraph sync`。
