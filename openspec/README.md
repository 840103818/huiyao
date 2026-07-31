# 绘钥 OpenSpec 规格中心

OpenSpec 保存绘钥当前稳定行为和复杂变更记录。规格描述系统必须做什么，代码与测试证明如何实现，`docs/` 面向用户和开发者解释如何使用、设计、维护和发布。

## 当前能力

| Capability | 范围 |
| --- | --- |
| [project-workspace](specs/project-workspace/spec.md) | 项目、任务、搜索筛选、队列、预设和废纸篓 |
| [image-ingestion-and-originals](specs/image-ingestion-and-originals/spec.md) | 图片校验、导入竞态、加密原图、配额与恢复 |
| [model-generation-streaming](specs/model-generation-streaming/spec.md) | 模型端点、SSE、兼容回退、容量、取消和打印 |
| [photography-analysis](specs/photography-analysis/spec.md) | 十项测定、分组、摘要、流式状态与 EXIF 白名单 |
| [result-revisions](specs/result-revisions/spec.md) | 只读基础结果、校正、锁定、重测、同步和比较 |
| [result-export-and-recovery](specs/result-export-and-recovery/spec.md) | 复制、单项与批量导出、原生保存和错误恢复 |
| [desktop-security](specs/desktop-security/spec.md) | 凭证、网络、本地权限、WebView、日志和危险操作 |
| [application-interaction](specs/application-interaction/spec.md) | 三栏布局、响应式、查看器、焦点和动态效果 |
| [data-compatibility](specs/data-compatibility/spec.md) | SQLite、旧历史、任务恢复和序列化兼容 |
| [engineering-change-governance](specs/engineering-change-governance/spec.md) | 复杂变更、敏感信息、验证与文档职责 |

## 目录

```text
openspec/
  config.yaml                 项目上下文、工件规则和操作约束
  specs/<capability>/spec.md  当前稳定行为
  changes/<change-name>/      活动变更
  changes/archive/            已完成变更
```

活动 change 通常包含：

```text
proposal.md                   为什么改、改什么、影响哪些能力
design.md                     跨模块方案、决策和风险
specs/*/spec.md               ADDED/MODIFIED/REMOVED 行为增量
tasks.md                      可跟踪的实施与验证任务
```

## 开发流程

### 1. 判断是否需要 OpenSpec

新功能、跨 React/Rust/IPC 的改动、SQLite 迁移、安全边界或大范围 UI 调整必须创建 change。文案、纯文档、依赖维护和不改变契约的局部修复可以直接使用普通独立分支。

### 2. 探索问题

```text
$openspec-explore
```

探索阶段可以阅读代码、CodeGraph 和文档，但不实施业务代码。需要明确用户问题、现有行为、失败条件、替代方案和影响范围。

### 3. 创建提案

```text
$openspec-propose "支持新的结果导出格式"
```

Codex 会创建 change 并生成 proposal、design、delta specs 和 tasks。实施前检查：

- Proposal 是否明确目标、非目标和 capability。
- Requirement 是否描述可观察行为而非组件实现。
- 每个 Requirement 是否至少有一个 `#### Scenario`。
- IPC、SQLite、安全、兼容和 UI 验证是否完整。

### 4. 实施变更

```text
$openspec-apply-change
```

Apply 会按 `tasks.md` 工作。每完成一项就更新复选框，不要在最后一次性标记。代码、测试、用户说明、技术说明和 UI 基线必须与任务同步。

### 5. 验证

```bash
npx openspec validate <change-name> --strict --no-interactive
npm run spec:validate
npm run check
git diff --check
codegraph sync
```

OpenSpec 校验规格结构和工件一致性；它不替代 Vitest、Rust、Mock HTTP、原生冒烟、依赖审计和浏览器视觉验证。

### 6. 归档

```text
$openspec-archive-change
```

Archive 将 delta specs 合并到 `openspec/specs/` 并把 change 移入 `openspec/changes/archive/`。归档前必须确认 tasks 和验收场景完成，长期决策已同步到产品、设计、工程或 ADR 文档。

## 常用 CLI

```bash
npm run spec:list                         # 活动变更
npm run spec:list -- --specs              # 当前能力
npx openspec show <change-or-spec>         # 查看工件
npx openspec status --change <name>        # 查看完成度
npx openspec validate <name> --strict      # 校验单个 change 或 spec
npm run spec:validate                      # 严格校验全部内容
npm run spec:view                          # 交互视图
npx openspec doctor --json                 # 检查仓库关系健康度
```

## 编写规则

- capability 和 change 名使用小写短横线。
- Requirement 使用 `### Requirement:`，正文使用 SHALL 或 MUST。
- Scenario 必须使用 `#### Scenario:`，并包含明确的 WHEN 和 THEN。
- 新能力 delta 使用 `## ADDED Requirements`；修改现有行为必须复制完整 Requirement 到 `## MODIFIED Requirements`。
- 删除行为必须说明 Reason 和 Migration。
- 规格不得包含 API Key、用户图片、Data URL、模型正文、未脱敏日志或隐私路径。
- 不在规格中写组件名、函数名、逐文件步骤；这些内容属于 design 或 tasks。

完整工程约束参见 [`config.yaml`](config.yaml)、[OpenSpec 工作流](../docs/engineering/openspec.md)和[AGENTS.md](../AGENTS.md)。
