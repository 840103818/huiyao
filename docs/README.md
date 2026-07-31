# 绘钥文档中心

本文档中心按“使用产品、理解设计、参与开发、完成发布”四条路径组织。根目录 [README](../README.md) 提供下载安装、首次配置、开发环境和常见问题的统一入口；本文档进一步索引专题说明。当前文档对应绘钥 `2.0.2`，历史实施记录保留在 `tasks/`，不作为当前行为说明。

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
- IPC、持久化或导出格式变化时，同步更新 TypeScript、Rust、浏览器降级实现及对应工程文档。
- 页面布局或样式变化时，同步覆盖 `assets/ui/current/` 中受影响的脱敏截图和索引。
- 发布前检查 README、版本记录、安装包名称和三处版本号一致。
