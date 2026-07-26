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

## 流式事件

- `started`：包含本次 `interactionId`。
- `delta`：包含模型返回的真实文本增量。
- `fallback`：服务不兼容首选流式方式，正在使用兼容路径。

命令 Promise 返回最终严格解析结果。主动停止保留前端已接收部分内容，但不自动写入历史。

## 原图 Raw IPC

请求体为 `HYUP` 魔数、4 字节大端元数据长度、UTF-8 JSON 元数据和原始文件字节。Rust 必须再次校验总容量、文件名、声明 MIME、真实格式和尺寸。
