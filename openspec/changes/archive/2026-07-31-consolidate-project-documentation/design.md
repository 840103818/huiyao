## Context

绘钥已经有完整的产品、设计、工程、运维、ADR 和历史任务文档，但稳定行为分散在多个文件中。例如导入上限、修订上限、SSE 回退和原图安全规则同时出现在 README、产品说明和工程说明。OpenSpec 已作为项目开发依赖和 CI 门禁接入，但除工程变更治理外尚无产品能力基线。

本次只调整规格与文档结构。运行时代码、IPC、SQLite、原图、Keychain、UI 和发布版本不变。

## Goals / Non-Goals

**Goals:**

- 将可观察、可测试的当前行为收敛到九个 OpenSpec capability。
- 让 README 和 `docs/` 保持适合人阅读的产品说明、操作步骤、架构解释与运维手册。
- 建立明确引用关系，后续行为变化先修改 delta spec，再同步对应长期文档。
- 保留历史实施记录和 Git 追踪，不做无法验证的历史规格重建。

**Non-Goals:**

- 不把所有 Markdown 机械移动到 `openspec/`。
- 不把内部函数、组件、SQL 或逐文件实现细节写入行为规格。
- 不修改任何运行时契约或补做旧版本需求考古。
- 不删除 ADR、发布手册、故障排查和 UI 基线。

## Decisions

### 1. 规格与说明分层，而不是整体搬迁

`openspec/specs/` 成为稳定行为的唯一规范来源；`docs/product/` 解释用户流程，`docs/design/` 解释设计原则，`docs/engineering/` 解释实现边界，`docs/operations/` 说明开发和发布操作。

选择该方式是因为 OpenSpec 的 Requirement/Scenario 适合验收契约，不适合安装教程、故障排查、架构图和截图索引。替代方案“全部移动到 OpenSpec”会降低用户文档可读性，也会把不需要随行为变更的内容混入规格校验。

### 2. 按用户能力与安全边界划分九个 capability

能力边界按项目工作、图片资产、模型生成、摄影测定、结果修订、导出恢复、安全、应用交互和数据兼容划分。每个规格只描述外部可观察行为和稳定约束，内部模块归属继续由工程文档维护。

替代方案是按前端/Rust/SQLite 分层建立规格，但一个用户行为通常跨越这些层，会导致验收场景分散且难以追踪。

### 3. 以当前代码和当前文档共同校验基线

规格中的数值、状态和兼容规则同时核对现有文档与代码常量。存在冲突时以当前可验证实现为准，并同步修正文档；不从早期计划中恢复已删除或未实施的功能。

### 4. 历史任务记录原位保留

`docs/tasks/` 作为 OpenSpec 接入前的历史证据保留，文档中心明确其只读属性。不会把这些文件伪装成已通过 OpenSpec 验证的 archive change，也不会删除可能仍被提交记录或外部链接引用的路径。

### 5. 使用真实 OpenSpec change 完成首次整合

本次新增规格先存在 `openspec/changes/consolidate-project-documentation/specs/`，完成文档更新和验证后使用 OpenSpec archive 同步到主规格。这样首次迁移本身也遵循后续要求维护者使用的流程。

## Risks / Trade-offs

- [规格与说明仍可能重复少量关键数值] → README 只保留用户操作必需摘要，并链接对应 capability；Review 时以 OpenSpec 为准。
- [九个 capability 初次基线较大] → 每个规格限制为稳定 Requirement 和 Scenario，不包含实现清单，后续用小型 delta 维护。
- [历史任务未迁入 archive 可能看似不统一] → 明确标记为 OpenSpec 接入前历史，避免伪造缺失的验收信息。
- [代码行为后续改变但只更新文档] → `npm run check` 严格校验 OpenSpec，AGENTS 和贡献指南要求复杂变更先创建 change。
- [OpenSpec 无法验证 Markdown 外部链接和代码事实] → 保留链接检查、项目测试、CodeGraph 和人工 Review；不把 OpenSpec 校验当作实现验证替代品。

## Migration Plan

1. 在活动 change 中建立九个新增 capability delta specs，并严格校验。
2. 更新 README、文档中心和对应产品、设计、工程、开发文档，声明事实来源和 capability 链接。
3. 保留 `docs/tasks/` 原文件，仅增加历史说明和索引状态。
4. 完成 OpenSpec、Markdown 链接、项目测试、diff 和 CodeGraph 验证。
5. 将 change 归档，使 delta specs 成为 `openspec/specs/` 当前基线。

回滚只需要撤销该文档提交；没有运行时、数据或安装包迁移。
