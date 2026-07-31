# OpenSpec 工作流

绘钥使用 OpenSpec `1.7.0` 管理复杂变更的行为规格、设计约束、实施任务和验收场景。OpenSpec 是开发期工具，不进入 Tauri 运行时，也不替代产品文档、架构文档、ADR、测试或 Git 工作流。

## 适用范围

必须创建 OpenSpec change：

- 新增或改变用户可见功能。
- 同时影响 React、Tauri IPC 和 Rust 的跨层改动。
- 修改 Channel 事件、serde 字段、导出结构或兼容行为。
- 修改 SQLite Schema、迁移、原图加密、Keychain 或安全边界。
- 大范围 UI/UX 重构、关键键盘流程或无障碍行为变化。

可以不创建 change：

- 文案、注释和纯说明文档修正。
- 不改变行为的依赖维护和发布版本同步。
- 边界明确、影响范围很小且不改变契约的缺陷修复。

## 事实来源

| 内容 | 位置 |
| --- | --- |
| 当前稳定行为 | `openspec/specs/` |
| 活动变更与增量规格 | `openspec/changes/<change-name>/` |
| 已完成变更 | `openspec/changes/archive/` |
| 用户说明 | `docs/product/` |
| 设计与交互规范 | `docs/design/` |
| 架构、IPC、安全和测试 | `docs/engineering/` |
| 长期架构决策 | `docs/adr/` |
| Agent 与 Git 约束 | `AGENTS.md` |

`docs/tasks/` 中的既有记录继续保留，但不再为新变更建立重复计划。OpenSpec 归档记录变更过程，长期有效结论仍需同步到对应文档和代码测试。

## 初始化与版本

OpenSpec 固定为 npm 开发依赖，Node.js 最低版本与项目一致，均为 `20.19.0`。新开发机只需执行：

```bash
npm ci
npx openspec --version
```

不要依赖未锁定的全局 CLI，也不要重新运行 `openspec init --force` 覆盖仓库内 Skills。升级 OpenSpec 时单独建立维护分支，核对生成文件差异后再提交。

## 标准流程

1. 从稳定 `master` 创建 `codex/<change-name>` 分支。
2. 使用 `$openspec-explore` 调研需求、调用链、边界和替代方案；此阶段不写业务代码。
3. 使用 `$openspec-propose "变更描述"` 生成 `proposal.md`、增量规格、`design.md` 和 `tasks.md`。
4. 人工确认目标、非目标、验收场景、安全与迁移风险。
5. 使用 `$openspec-apply-change` 按任务实施，并同步测试和长期文档。
6. 执行完整验证，确认规格与实现一致。
7. 使用 `$openspec-archive-change` 合并增量规格并归档 change。
8. 提交分支并交由维护者人工检查；除非用户明确要求，不自动合并或发布。

常用 CLI：

```bash
npm run spec:list
npx openspec show <change-name>
npx openspec validate <change-name> --strict --no-interactive
npm run spec:validate
npm run spec:view
```

## 规格要求

- Requirement 描述系统必须满足的行为，不描述组件名或函数实现。
- Scenario 使用可观察的前置条件、操作和结果，覆盖成功、失败、取消及兼容路径。
- Proposal 必须明确用户问题、目标、非目标、影响范围和验收标准。
- Design 只记录需要跨模块协调、存在取舍或难以从代码理解的实现决策。
- Tasks 必须包含实现、Review、测试、文档和最终验证，不能只写“完成开发”。

涉及 IPC、serde 或结果结构时，同时核对 TypeScript contracts、Rust models、浏览器降级和测试。涉及 SQLite 时必须提供幂等迁移、回滚路径和旧数据库验证。涉及 UI 时必须明确双尺寸、双主题、键盘、焦点、减少动态效果和脱敏截图范围。

## 安全限制

OpenSpec 文件会进入 Git，禁止写入：

- API Key、Token、钥匙串内容或真实服务凭证。
- 用户原图、缩略图正文、图片 Data URL 或模型请求正文。
- 原始模型响应、未脱敏诊断、日志正文或用户文件路径。
- 为复现问题临时采集的个人信息。

只记录结构、长度、状态、错误码和经过脱敏的可复现条件。

## 验证门禁

```bash
npm run spec:validate
npm run check
git diff --check
codegraph sync
```

`npm run check` 已包含严格 OpenSpec 校验。安全变更还需执行依赖审计；发布变更继续遵循 `docs/operations/release.md`。OpenSpec 校验只验证规格结构和一致性，不能替代前端、Rust、Mock、原生和视觉测试。
