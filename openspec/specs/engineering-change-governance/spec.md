# Engineering Change Governance Specification

## Purpose

定义绘钥复杂工程变更的规格驱动流程，使需求、设计、实现、验证和长期文档保持一致，同时避免为小型维护任务增加不必要的流程成本。

## Requirements

### Requirement: 复杂变更必须先形成可审查规格

系统工程流程 SHALL 要求新功能、跨层契约变化、数据迁移、安全边界调整和大范围 UI 重构在实施前建立 OpenSpec change，并提供目标、非目标、设计、增量规格、任务和验收场景。

#### Scenario: 跨前后端功能进入实施

- **WHEN** 一个变更同时影响 React、Tauri IPC 和 Rust
- **THEN** 开发必须先创建并审查对应 OpenSpec change，之后才能修改业务代码

#### Scenario: 小型维护任务

- **WHEN** 任务只涉及文案、纯文档、依赖维护或不改变契约的局部修复
- **THEN** 开发可以使用普通独立分支流程而不创建 OpenSpec change

### Requirement: 规格不得包含敏感或私有内容

所有 OpenSpec 产物 SHALL 只记录结构化需求、约束、长度、状态、错误码和脱敏复现条件，不得记录凭证、用户原图、图片正文、模型正文、未脱敏日志或本机隐私路径。

#### Scenario: 记录模型请求故障

- **WHEN** 变更需要描述模型请求失败场景
- **THEN** 规格只记录协议状态、错误码、容量边界和脱敏条件，不写入 API Key、提示词或原始响应

### Requirement: 归档前必须完成工程验证

OpenSpec change SHALL 仅在实现任务、验收场景、长期文档和必要测试均完成后归档，并保留实际验证结果。

#### Scenario: 完成普通复杂变更

- **WHEN** 开发准备归档一个已实施的 change
- **THEN** 必须先通过严格 OpenSpec 校验、`npm run check`、`git diff --check` 和 `codegraph sync`

#### Scenario: 变更涉及安全或界面

- **WHEN** change 修改安全边界或用户界面
- **THEN** 归档前还必须分别完成依赖审计，或完成双尺寸双主题、键盘焦点和脱敏截图验证

### Requirement: OpenSpec 与长期文档职责必须分离

工程流程 SHALL 使用 `openspec/specs/` 维护稳定行为、使用 `openspec/changes/` 维护增量变更，同时继续以产品、设计、工程、运维和 ADR 文档记录面向不同读者的长期事实。

#### Scenario: 变更产生长期架构决策

- **WHEN** OpenSpec change 引入难以从代码理解且长期有效的架构决策
- **THEN** 归档前必须新增或更新对应 ADR，而不是只把决策留在已归档 change 中

#### Scenario: 保留旧任务记录

- **WHEN** 仓库中存在接入 OpenSpec 之前的 `docs/tasks/` 记录
- **THEN** 这些记录保持只读历史，不迁移、不删除，也不再为新变更建立重复任务文档
