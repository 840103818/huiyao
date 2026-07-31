## Why

绘钥当前稳定行为分散在 README、产品说明、交互规范、安全说明、IPC 文档和历史任务记录中，同一容量限制、兼容规则或操作约束需要多处同步，容易产生版本漂移。现在仓库已经接入 OpenSpec，需要把可验收的系统行为提炼为统一 capability specs，同时让面向用户和开发者的文档只承担解释、操作与架构导航职责。

## What Changes

- 从现有代码和当前文档提炼九个稳定能力规格，不改变运行时实现、IPC、SQLite、原图格式或 UI。
- 将产品、交互、安全、迁移和导出中的规范性事实改为引用 OpenSpec，保留必要的操作步骤和架构解释。
- 将 `docs/tasks/` 明确标记为 OpenSpec 接入前的历史记录，不重写、不删除原始实施证据。
- 补充开发者使用 OpenSpec 的完整流程、命令、工件职责、验收和归档说明。
- 在 README 和文档中心增加能力规格入口，建立“规格描述行为、文档解释使用、代码和测试证明实现”的维护规则。

非目标：

- 不修改任何用户可见功能、界面样式、模型协议、Tauri 命令或持久化数据。
- 不把发布手册、故障排查、ADR、视觉截图和面向用户的操作教程机械搬入 OpenSpec。
- 不根据历史任务记录反向编造已经无法验证的旧版本需求。

## Capabilities

### New Capabilities

- `project-workspace`: 项目、任务、搜索筛选、队列、预设、分页和废纸篓的当前稳定行为。
- `image-ingestion-and-originals`: 图片导入限制、竞态处理、原图加密归档、配额、恢复和查看能力。
- `model-generation-streaming`: 模型服务配置、真实 SSE、兼容回退、取消、打印缓冲和部分结果规则。
- `photography-analysis`: 十项摄影测定、三组结构、摘要展开、色板、EXIF 白名单和组内定位行为。
- `result-revisions`: 基础结果只读、人工校正、字段锁定、AI 重测、提示词同步、平台优化和修订上限。
- `result-export-and-recovery`: 复制、Markdown/JSON/文本/ZIP 导出、原图导出、诊断与失败恢复规则。
- `desktop-security`: 凭证、网络、WebView、本地权限、日志脱敏、响应容量和危险操作边界。
- `application-interaction`: 工作台布局、响应式 Drawer、图片查看器、键盘焦点、状态反馈和减少动态效果。
- `data-compatibility`: SQLite 初始化、旧历史迁移、会话恢复、结果修订兼容和导出 Schema 规则。

### Modified Capabilities

- 无。本次建立当前行为基线，不改变已有 `engineering-change-governance` 要求。

## Impact

- 新增 `openspec/specs/` 下的当前能力规格；活动 change 归档后成为后续变更的基线。
- 更新 README、`docs/product/`、`docs/design/`、`docs/engineering/`、`docs/operations/development.md` 和文档中心的职责说明与链接。
- 保留 `docs/tasks/`、ADR、发布、故障排查和 UI 截图原位置，避免破坏历史链接与读者路径。
- 无运行时、构建产物、数据迁移或发布影响；验证重点为 OpenSpec 严格校验、Markdown 链接、现有项目检查和 CodeGraph 同步。
