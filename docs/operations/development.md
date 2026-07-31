# 开发指南

## 环境

- Apple Silicon Mac，macOS 12 或以上。
- Node.js `>=20.19.0`，npm `>=10`。
- Rust `>=1.95.0`、`aarch64-apple-darwin` 目标和 `rustfmt`。
- 生产打包需要 `ld64.lld`、Xcode Command Line Tools 和 Tauri 系统依赖。

```bash
xcode-select --install
nvm install
nvm use
npm ci
rustup toolchain install stable --profile minimal
rustup default stable
rustup target add aarch64-apple-darwin
rustup component add rustfmt
```

仓库 `.nvmrc` 使用 Node.js 22。若生产打包环境缺少 `ld64.lld`，可安装 Homebrew LLVM，并将 `/opt/homebrew/opt/llvm/bin` 加入 `PATH`。完整的新开发机步骤和命令说明参见根目录 [README](../../README.md#开发环境)。

`libsqlite3-sys 0.38` 使用 Rust 1.95 稳定的 `cfg_select!`。日常检查读取当前 `PATH` 中的工具链；macOS 发布脚本固定使用官方 `rustup stable`，并在构建前检查版本，避免 Homebrew 标准库的部署目标高于 macOS 12。运行 `rustup run stable rustc --version` 可确认实际发布版本。

仓库级 `.npmrc` 固定使用 npm 官方源。`npm run verify:lockfile` 会拒绝锁文件中的第三方下载地址或缺少 `integrity` 的下载项；升级依赖后必须先执行该校验，不要提交由个人镜像生成的 `resolved` 地址。

## 启动

```bash
npm run dev:desktop  # 完整桌面能力
npm run dev          # 仅调试前端
```

Vite 固定使用 `127.0.0.1:1420`。配置只来自 `vite.config.ts`，不要创建会遮蔽它的 `vite.config.js`。

项目工作区的脱敏浏览器预览可使用：

```text
http://127.0.0.1:1420/?workspace-preview=1
http://127.0.0.1:1420/?workspace-preview=task
http://127.0.0.1:1420/?workspace-preview=streaming
```

三个入口依次用于项目概览、完整任务结果和生成中间态。预览只在开发构建中生效，仅提供本地脱敏项目、任务、预设和结果测试数据，不调用模型、Keychain、SQLite 或原图接口。

## 开发流程

1. 检查 `git status`，记录并保留已有未提交修改；从当前稳定基线建立独立功能分支。
2. 阅读对应产品、设计和工程文档。
3. 复杂或跨层变更先创建 OpenSpec change，并确认 proposal、增量 specs、design 和 tasks；小型修复可跳过。
4. 存在 `.codegraph/` 时运行 `codegraph explore "问题或符号"`。
5. 按功能目录修改代码并补充共置测试。
6. 同步操作说明、技术说明；页面变更同步视觉基线。
7. 运行 `npm run check`、`git diff --check` 和 `codegraph sync`，完成后归档 OpenSpec change。
8. 不自动合并 `master`；向维护者提交分支名、测试结果和人工合并提示。

OpenSpec 版本随 npm 锁文件固定，不依赖开发机全局版本。常用入口：

```bash
npx openspec --version
npm run spec:list
npm run spec:validate
npm run spec:view
```

完整职责边界、命令流程、工件示例和规格写法参见 [OpenSpec 工作流](../engineering/openspec.md)，当前稳定能力参见 [OpenSpec 规格中心](../../openspec/README.md)。

## 工作区数据库调试

- 数据库位于 Tauri 应用私有目录，文件名为 `workspace.sqlite3`。
- 调试数据库不得读取或输出提示词正文、缩略图、EXIF 或用户文件名。
- Schema 修改集中在 `infrastructure/persistence/workspace.rs`，必须保持幂等并增加旧数据库测试。
- 应用启动会把活动任务改为暂停。测试队列恢复时必须由用户动作继续。

## Mock 与针对性测试

```bash
npm test -- src/features/prompts/PromptPanel.test.tsx
cargo test --locked --manifest-path src-tauri/Cargo.toml api::tests -- --nocapture
```

HTTP 测试使用本地 Mock 服务，不接触真实 API Key。浏览器验证优先使用 `browser-skill`；扩展不可用时可使用工作区 Playwright 依赖执行同等尺寸检查，并在结果中说明降级。测试数据不得包含用户图片或模型正文。

界面验收至少检查 1440×900 浅色和 1120×720 深色，并确认 `scrollWidth === clientWidth`、Drawer/Modal 主题正确、分隔器可键盘操作。更新后的截图直接覆盖 `docs/assets/ui/current/` 对应基线，临时对比图放入 `artifacts/visual-review/`。

## 目录约定

- 功能组件、Hook、工具和测试放入同一 `features/<name>/`。
- 跨功能数据进入 `shared/contracts/`；不要建立宽泛 barrel。
- 组件只能通过 `infrastructure/tauri/` 调用桌面能力。
- Rust 命令只适配参数；业务逻辑进入 `application/`，外部能力进入 `infrastructure/`。
- 构建和视觉产物统一放入 `artifacts/`。

## CodeGraph

仓库已存在 `.codegraph/`，可直接探索和同步；禁止在未初始化仓库中擅自初始化。目录移动完成后必须运行 `codegraph sync`。
