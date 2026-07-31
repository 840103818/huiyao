# 绘钥文档中心

本文档中心按“使用产品、理解设计、参与开发、完成发布”四条路径组织。根目录 [README](../README.md) 提供下载安装、首次配置、开发环境和常见问题的统一入口；本文档进一步索引专题说明。当前文档对应绘钥 `2.0.3`，规范性行为以 [OpenSpec 当前规格](../openspec/README.md)为准；历史实施记录保留在 `tasks/`，不作为当前行为说明。

## 当前规格

| 能力 | OpenSpec |
| --- | --- |
| 项目、任务、队列、预设与废纸篓 | [project-workspace](../openspec/specs/project-workspace/spec.md) |
| 图片导入、原图归档与恢复 | [image-ingestion-and-originals](../openspec/specs/image-ingestion-and-originals/spec.md) |
| 模型请求、SSE、回退与取消 | [model-generation-streaming](../openspec/specs/model-generation-streaming/spec.md) |
| 摄影测定与 EXIF 白名单 | [photography-analysis](../openspec/specs/photography-analysis/spec.md) |
| 人工校正、AI 重测与统一修订 | [result-revisions](../openspec/specs/result-revisions/spec.md) |
| 复制、导出、诊断与恢复 | [result-export-and-recovery](../openspec/specs/result-export-and-recovery/spec.md) |
| 凭证、网络、本地数据与 WebView 安全 | [desktop-security](../openspec/specs/desktop-security/spec.md) |
| 工作台、查看器、焦点与动态效果 | [application-interaction](../openspec/specs/application-interaction/spec.md) |
| SQLite、旧历史与序列化兼容 | [data-compatibility](../openspec/specs/data-compatibility/spec.md) |

## 用户与产品

| 文档 | 适合了解 |
| --- | --- |
| [产品与使用说明](product/overview.md) | 产品定位、核心流程、数据保留和快捷键 |
| [项目工作台](product/workspace.md) | 项目、批量导入、队列、预设、筛选和废纸篓 |
| [专业精修](product/refinement.md) | 人工校正、字段锁定、AI 重测、提示词同步、修订比较与导出 |
| [版本更新记录](../CHANGELOG.md) | 各版本面向用户的变化和安装包说明 |

## 设计与交互

| 文档 | 适合了解 |
| --- | --- |
| [界面设计系统](design/ui-system.md) | 语义 Token、布局、色彩、密度和组件规范 |
| [交互规范](design/interaction.md) | 工作台、流式反馈、查看器、焦点和确认操作 |
| [当前界面基线](assets/ui/current/README.md) | 双尺寸、双主题及关键交互截图索引 |

## 工程与安全

建议新开发者依次阅读：

1. [总体架构](engineering/architecture.md)
2. [前端架构](engineering/frontend.md)与[后端架构](engineering/backend.md)
3. [IPC 契约](engineering/ipc-contracts.md)与[数据迁移](engineering/data-migration.md)
4. [安全边界](engineering/security.md)、[测试策略](engineering/testing.md)与[OpenSpec 工作流](engineering/openspec.md)
5. [架构决策记录](adr/README.md)

## 开发与发布

| 文档 | 适合了解 |
| --- | --- |
| [开发指南](operations/development.md) | 环境、调试、Mock、测试和 CodeGraph |
| [OpenSpec 工作流](engineering/openspec.md) | 复杂变更的规格、实施、验证和归档 |
| [故障排查](operations/troubleshooting.md) | 白屏、构建、签名、网络与本地数据问题 |
| [macOS 发布指南](operations/release.md) | 检查、打包、签名、验证、标签和 GitHub Release |

首次参与开发时先按根目录 README 安装 Node.js、Rust 与 macOS 构建工具，再阅读开发指南中的目录边界、Mock 和视觉验证要求。

## 维护规则

- 当前行为写入 `product/`、`design/`、`engineering/` 或 `operations/`；不要把实施计划当成产品说明。
- `openspec/specs/` 维护当前稳定行为，`openspec/changes/` 维护复杂变更；既有 `tasks/` 仅作为历史记录保留。
- 说明文档可以摘要规格，但数值、状态、兼容和安全要求冲突时以当前 OpenSpec 和已验证代码为准。
- IPC、持久化或导出格式变化时，同步更新 TypeScript、Rust、浏览器降级实现及对应工程文档。
- 页面布局或样式变化时，同步覆盖 `assets/ui/current/` 中受影响的脱敏截图和索引。
- 发布前检查 README、版本记录、安装包名称和三处版本号一致。
