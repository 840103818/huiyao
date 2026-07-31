# 2.0 数据迁移

本文保留迁移实现顺序和恢复说明；当前兼容性契约以 [data-compatibility](../../openspec/specs/data-compatibility/spec.md) 为准。

## 迁移目标

1.0 使用应用私有目录中的 `workspace.sqlite3` 管理项目、任务、标签、预设、提示词版本和软删除状态。数据库启用 WAL、外键、5 秒忙等待和私有文件权限。

## 首次迁移

1. 若数据库不存在，在同目录创建临时数据库并建立完整 Schema。
2. 创建“我的项目”和四个内置预设。
3. 读取现有 `history.json`，将原 ID、标题、缩略图、摄影测定、提示词版本、EXIF 和原图元数据迁入“历史记录”项目。
4. 写入 `history_migrated` 标记并执行完整性检查。
5. 关闭临时数据库后原子改名为 `workspace.sqlite3`，再启用 WAL。

迁移使用旧历史 ID 作为原图资产 ID，因此不会移动、复制或重新加密已有 `.hyi` 文件。`history.json` 与旧 Keychain 项保留用于回退，前端 1.0 不再写入旧历史。

## 兼容与恢复

- 所有插入使用稳定 ID 和幂等标记，重复启动不会复制历史。
- 启动时把遗留的 `queued/preparing/running` 任务恢复为 `paused`，禁止自动产生费用。
- 数据库创建失败时应用拒绝进入不完整工作区，不覆盖旧历史或原图。
- 永久删除在确认数据库不再引用资产后清理隔离原图；共享资产仅在最后一个任务引用删除后清理。

## 结果修订兼容

2.0 不修改 SQLite Schema，统一修订继续存入任务现有 `result_json`。旧结果缺少 `resultRevisions` 和 `activeResultRevisionId` 时由 serde 默认为空。

旧 `promptVersions` 保持原样可读。用户首次创建人工校正、AI 重测、提示词编辑或平台优化时，前端把现有提示词版本幂等转换为统一 `ResultRevision`，保留 ID、标题、来源关系、平台、正负提示词和生成元数据；基础摄影测定作为旧版本的测定快照。转换成功保存前不覆盖旧字段，失败可继续使用旧版本。

结构化导出升级为 `schemaVersion: 2`，增加 `activeRevision` 并让 `analysis`、`activePrompt` 指向当前活动修订。Markdown 和纯文本格式保持可读兼容。
