# AGENTS.md

## 项目目标

绘钥是 React + TypeScript + Tauri 2 构建的 macOS 图片反向提示词工具。前端负责交互和流式局部 JSON 展示，Rust 负责模型请求、取消、日志、历史、原图加密和钥匙串访问。

## 开始修改前

1. 阅读 `README.md`、`docs/engineering/architecture.md` 和对应模块文档。
2. 仓库存在 `.codegraph/` 时，优先使用 `codegraph explore` 定位调用链。
3. 检查工作区状态，不覆盖用户尚未提交的改动。
4. 不读取、输出或提交 API Key、Token、钥匙串内容、图片 Data URL、用户原图和模型正文。

## Git 工作流

- 功能开发和缺陷修复必须在独立分支进行，不直接修改或提交到 `master`。
- 建立分支前保留当前工作区内容，不自动 rebase、merge、reset 或覆盖本地修改。
- 分支内完成代码、测试、文档和产物验证后，报告分支名、验证结果和差异摘要。
- 不自动合并到 `master`；最终必须提醒用户人工检查并合并。
- 本地 `master` 与远端分叉时，不擅自拉取、变基或强制推送。

## 目录边界

- `src/app/`：应用装配、Shell、页面路由和顶层状态。
- `src/features/`：按图片输入、生成、分析、提示词、历史、设置和诊断聚合界面与测试。
- `src/features/projects/`：项目、任务队列、预设、筛选、废纸篓和批量交互。
- `src/infrastructure/tauri/`：Tauri IPC 和浏览器降级实现。
- `src/shared/contracts/`：前端跨功能、跨端数据契约。
- `src/styles/`：全局 Token、基础、Arco、Shell 和响应式样式。
- `src-tauri/src/commands/`：Tauri 参数适配和命令注册，不定义持久化格式。
- `src-tauri/src/application/`：应用用例和可复用结果处理。
- `src-tauri/src/domain/`：领域模型与错误契约，不依赖 Tauri。
- `src-tauri/src/infrastructure/`：HTTP、持久化、图片、日志、Keychain 和原生对话框。
- `docs/`：产品、设计、工程、运维、ADR 和任务记录。
- `artifacts/`：本地产物，禁止提交。

依赖方向为 `app/features -> infrastructure/shared` 和 `commands -> application/domain/infrastructure`。禁止 `shared` 反向依赖具体功能，禁止 `domain` 依赖 Tauri。

## 实现规则

- 优先复用现有 Arco Design 组件、语义化 Token 和 IPC 接口。
- 不在 WebView 中持久化 API Key，不在日志中记录请求正文或模型响应正文。
- 流式协议、历史、设置和 IPC 变更必须同步更新 TypeScript、Rust、浏览器降级实现和测试。
- `PromptVersion`、EXIF 白名单和导出结构变更必须同时核对前端与 Rust 序列化。
- `workspace.sqlite3` 结构变更必须增加幂等迁移和回滚测试；旧 `history.json` 只读保留，不得覆盖。
- Vite 配置以 `vite.config.ts` 为唯一来源。
- 用户可见文本默认使用简体中文；模型名、请求 ID、`API Key`、`Base URL` 等技术标识可保留英文。
- 修改保持聚焦；能复用不新增抽象，能配置解决不新增代码。

## 完成标准

```bash
npm run check
git diff --check
codegraph sync
```

安全相关变更补充依赖审计；发布变更按 `docs/operations/release.md` 验证 Apple Silicon 产物。

## 文档与界面留存

- 每次代码修改同步更新对应用户说明和技术说明。
- 页面布局或样式修改后覆盖 `docs/assets/ui/current/` 的双尺寸、双主题和关键交互截图。
- 工作台布局变更至少留存项目概览、窄屏项目 Drawer、设置、日志和确认弹层；任务内容截图按受影响功能补充。
- 截图只使用测试数据，不留存凭证、模型正文、用户原图或隐私数据。
