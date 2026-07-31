## Why

仓库本地工作区积累了约 7.3 GB 可重建的 Rust、Tauri、Vite 和 TypeScript 生成物，以及已被当前版本替代的发布备份和临时视觉审查文件。这些内容不参与版本控制或运行时行为，却持续占用磁盘，并增加工作区审计和发布产物识别成本。

## What Changes

- 清理 Cargo、测试、Tauri、Vite 和 TypeScript 可重建缓存与生成物。
- 清理 Finder 元数据和确认无内容的空目录。
- 清理已被当前版本替代的旧 App 备份与 2.0.1 安装包。
- 清理 `artifacts/visual-review/` 中的临时视觉审查产物。
- 保留当前发布产物、代码图谱、OpenSpec、文档基线、源码、测试、脚本、依赖目录和未提交工作区修改。
- 清理前后记录目标是否存在、实际释放空间和 Git 工作区状态，避免误删或把 ignored 文件变化混入业务提交。

## Capabilities

### New Capabilities

无。本变更属于本地工程维护，不引入新的产品能力。

### Modified Capabilities

无。本变更不改变运行时行为、接口、持久化格式或发布流程，已通过 `skip_specs: true` 明确跳过增量规格。

## Impact

- 影响本地被忽略的构建缓存、生成目录、旧发布备份和临时视觉审查目录。
- 不影响 React、Rust、Tauri IPC、SQLite、Keychain、加密原图、当前发布包或长期文档。
- 清理后首次前端或 Rust 构建耗时会增加，因为相关缓存需要重新生成。
- 两个旧 App 备份可能受 root 所有权限制；若普通权限无法删除，应停止该项并单独报告，不扩大权限变更范围。
