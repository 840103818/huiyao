# IPC 契约

## 稳定原则

- TypeScript 使用 camelCase，Rust 使用 snake_case 并由 serde 转换。
- 命令名、参数名和 Channel 事件视为兼容接口，重命名需要迁移方案。
- 新增持久化字段必须提供默认值，旧历史和设置必须可反序列化。
- 二进制原图使用 Raw IPC，不使用 Base64 或前端路径。

## 命令分组

| 分组 | 命令 |
| --- | --- |
| 设置 | `get_settings`、`save_settings`、`save_theme`、`save_workspace_preferences`、`test_connection` |
| 生成 | `reverse_prompt_stream`、`optimize_prompt_stream`、`cancel_reverse_prompt` |
| 历史 | `load_history`、`save_history` |
| 原图 | `stage_original_image`、`discard_original_stage`、`load_original_image`、`export_original_image`、`remove_history_original`、`clear_original_images`、`get_original_storage_stats` |
| 导出 | `export_result`、`export_runtime_logs`、`export_diagnostic` |
| 日志 | `load_runtime_logs`、`clear_runtime_logs` |

## 1.0 工作区命令

- 项目：`list_projects`、`create_project`、`rename_project`、`delete_project`。
- 任务：`list_project_tasks`、`get_project_task`、`import_project_task`、`update_project_task_status`、`complete_project_task`、`update_project_task_result`、`fail_project_task`。
- 任务组织：`set_project_task_favorite`、`set_project_task_tags`、`move_project_tasks`、`reorder_project_tasks`、`duplicate_project_task`、`delete_project_tasks`。
- 队列与预设：`get_batch_progress`、`list_reverse_presets`、`save_reverse_preset`、`delete_reverse_preset`。
- 废纸篓：`list_trash`、`restore_trash_entry`、`permanently_delete_trash_entry`、`empty_trash`。
- 原图与导出：`load_workspace_original_image`、`export_workspace_original_image`、`export_project_tasks`。
- 会话：`save_workspace_session`，只更新上次项目和任务，不覆盖模型设置。

`TaskStatus` 固定为 `ready / queued / preparing / running / completed / failed / paused / cancelled / blocked`。列表请求使用 `offset/limit`，后端把 `limit` 限制为 50。

`complete_project_task` 只允许运行中的任务进入完成态；已完成任务保存提示词派生版本时使用 `update_project_task_result`，该命令不改变任务状态。两条写入路径都执行 2 MiB 结果容量限制。

## 流式事件

- `started`：包含本次 `interactionId`。
- `delta`：包含模型返回的真实文本增量。
- `fallback`：服务不兼容首选流式方式，正在使用兼容路径。

命令 Promise 返回最终严格解析结果。主动停止保留前端已接收部分内容，但不自动写入历史。

## 原图 Raw IPC

请求体为 `HYUP` 魔数、4 字节大端元数据长度、UTF-8 JSON 元数据和原始文件字节。Rust 必须再次校验总容量、文件名、声明 MIME、真实格式和尺寸。
