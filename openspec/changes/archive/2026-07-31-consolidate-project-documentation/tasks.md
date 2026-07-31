## 1. 能力规格基线

- [x] 1.1 从当前产品、设计、IPC、安全、迁移文档与代码常量梳理稳定行为
- [x] 1.2 建立项目、图片、模型、测定、修订、导出、安全、交互和兼容九个 capability delta specs
- [x] 1.3 使用 `openspec validate consolidate-project-documentation --strict --no-interactive` 验证 change 结构与场景格式

## 2. 文档职责整合

- [x] 2.1 更新 README 和文档中心，增加 OpenSpec 当前能力入口与事实来源说明
- [x] 2.2 更新产品、设计和工程文档，链接对应 capability 并移除“实施计划即当前规范”的歧义
- [x] 2.3 增加 `openspec/README.md` 和完整开发教程，说明 propose、apply、validate、archive 流程
- [x] 2.4 将 `docs/tasks/` 标记为接入前只读历史，保留原文件和路径

## 3. Review 与验证

- [x] 3.1 复核九个规格中的容量、状态、兼容和安全约束与当前代码一致
- [x] 3.2 运行 Markdown 本地链接检查和 `npm run spec:validate`
- [x] 3.3 运行 `npm run check`、`npm audit --registry=https://registry.npmjs.org` 和 `git diff --check`
- [x] 3.4 执行 `codegraph sync` 并确认无运行时代码或 UI 变化

## 4. 归档准备

- [x] 4.1 确认九个 delta specs 均为新增主规格且不覆盖现有工程治理规格
- [x] 4.2 确认分支差异只包含 OpenSpec、说明文档和工程门禁，不包含运行时代码或 UI 变化
