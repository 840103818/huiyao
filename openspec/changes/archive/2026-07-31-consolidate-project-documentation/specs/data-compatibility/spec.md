## Purpose

定义工作区数据库初始化、旧历史幂等迁移、任务状态恢复、序列化默认值、原图引用和结果修订演进必须遵守的数据兼容行为。

## ADDED Requirements

### Requirement: 工作区数据库必须原子初始化

应用 SHALL 在私有目录使用启用外键、WAL 和忙等待的 `workspace.sqlite3`；首次创建必须先建立并校验临时数据库，再原子替换正式文件，失败时不得留下可用但不完整的工作区。

#### Scenario: 首次数据库创建失败

- **WHEN** Schema 建立、默认数据写入或完整性检查失败
- **THEN** 应用拒绝进入不完整工作区，并保留旧历史、原图和 Keychain 项

### Requirement: 旧历史必须幂等迁入独立项目

应用 SHALL 将旧 `history.json` 的 ID、标题、缩略图、测定、提示词版本、白名单 EXIF 和原图元信息迁入“历史记录”项目，并记录稳定迁移标记；重复启动不得复制记录或重新加密原图。

#### Scenario: 迁移后再次启动

- **WHEN** 数据库已经记录历史迁移完成
- **THEN** 应用不重复插入旧记录，不移动 `.hyi` 文件，也不覆盖 `history.json`

### Requirement: 活动任务恢复必须避免自动费用

应用启动 SHALL 将遗留 queued、preparing 和 running 状态恢复为 paused，用户必须主动继续。

#### Scenario: 生成期间异常退出

- **WHEN** 应用下次启动发现任务仍为 running
- **THEN** 任务显示为 paused，且在用户操作前不发送模型请求

### Requirement: 新增持久化字段必须提供兼容默认值

设置、历史和结果模型新增字段 SHALL 使用 serde 或等价默认值读取旧数据；旧字段在完成可验证迁移前不得从持久化结构中删除。

#### Scenario: 读取缺少统一修订字段的旧结果

- **WHEN** `result_json` 没有 `resultRevisions` 或 `activeResultRevisionId`
- **THEN** 应用将其读取为空修订状态并继续展示基础结果

### Requirement: 旧提示词版本必须延迟且幂等转换

旧 `promptVersions` SHALL 保持可读，直到用户首次创建人工校正、AI 重测、提示词编辑或平台优化时才转换为统一修订；保存失败不得覆盖旧字段。

#### Scenario: 首次派生修订保存失败

- **WHEN** 旧提示词版本已在内存转换但任务结果写入失败
- **THEN** 持久化数据仍保留原 `promptVersions`，用户下次可以继续使用并重试转换

### Requirement: 任务终态和结果写入必须分离

任务状态机 SHALL 阻止普通完成或失败写入覆盖已完成结果；保存统一修订必须使用不重新打开终态的结果更新路径，并继续执行 2 MiB 结果容量和 12 个派生修订限制。

#### Scenario: 已完成任务保存新修订

- **WHEN** 用户在 completed 任务中保存合法派生修订
- **THEN** 结果 JSON 更新而任务仍保持 completed，队列状态不重新开始
