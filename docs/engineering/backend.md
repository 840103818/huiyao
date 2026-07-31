# Rust 后端架构

本文记录 Rust 分层和基础设施实现。数据兼容、桌面安全、模型传输、原图和导出行为的验收契约统一索引在 [OpenSpec 规格中心](../../openspec/README.md)。

## SQLite 工作区

`infrastructure/persistence/workspace.rs` 是项目数据的唯一持久化入口。它负责 Schema、WAL/外键、分页搜索、状态机、标签、预设、软删除和旧历史迁移。Tauri 适配位于 `commands/workspace.rs`，ZIP 编排位于 `application/workspace_export.rs`。

数据库只保存结构化 JSON 和原图资产 ID。加密字节继续由 `infrastructure/images/` 管理，Keychain 服务名和原图文件格式保持不变。

任务列表查询只返回分页所需的轻量字段，`result` 固定为空；选择单条任务后再通过 `get_project_task` 读取完整结果。搜索仍直接在数据库的 `result_json` 上执行。完成、失败和永久删除均在事务内复核当前状态，防止绕过状态机或废纸篓。已完成任务的统一结果修订通过独立结果更新用例保存，不重新执行终态转换。结果写入同时执行 2 MiB 容量、12 个修订上限、活动修订引用和派生引用校验。

SQLite 的整数读写统一按有符号 `i64` 进入 `rusqlite`，计数返回领域模型前执行非负校验并转换为 `u64`；分页参数在查询前执行范围转换，避免依赖数据库驱动对无符号整数的隐式支持。

## 层次

- `bootstrap.rs`：公开桌面启动入口。
- `commands/`：Tauri 参数适配、命令注册和原生窗口生命周期。
- `application/`：可复用应用用例与结果序列化。
- `domain/models.rs`：IPC、持久化和模型结果的数据契约及错误类型。
- `infrastructure/http/`：端点校验、请求构建、流式传输、解析、错误映射和 SSE。
- `infrastructure/persistence/`：设置、历史、私有文件权限和旧数据迁移。
- `infrastructure/images/`：原图验证、EXIF 白名单、加密、归档和清理。
- `infrastructure/logging/`：运行日志与短期脱敏诊断缓存。
- `infrastructure/keychain.rs`：API Key、原图密钥和旧服务迁移。
- `state.rs`：共享客户端、锁、并发槽和取消令牌。

## 并发与阻塞操作

模型请求受 `Semaphore` 限制并由 `CancellationToken` 管理；窗口关闭会取消活动请求。图片解码、加密和文件写入应通过 `spawn_blocking` 离开 Tokio 执行线程。共享设置、历史、日志和原图事务使用独立锁，避免无关操作互相阻塞。

项目原图提交会解密暂存文件并在 Rust 侧重建可信格式、容量、尺寸和 EXIF 元数据，再执行配额检查与归档。批量 ZIP 使用目标目录内的私有唯一临时文件，任何写入或重命名错误都必须清理临时文件。

`refine_analysis_stream` 与反推、提示词优化共用请求并发槽、`CancellationToken`、禁止重定向客户端、SSE 上限和兼容回退。请求只记录图片负载长度、锁定字段数量和要求长度；后端解析最终结果后再次恢复所有锁定字段，模型正文不进入日志。

任务重命名、批量收藏和批量标签命令均在工作区锁内执行。批量标签使用单一 SQLite 事务，任一任务或标签校验失败时不会留下部分更新。

## 错误与日志

命令返回结构化 `CommandError`。供应商响应正文只进入有界、脱敏、短期诊断缓存，不返回 WebView，也不写运行日志。日志只记录错误码、请求 ID、长度、阶段、耗时和兼容回退等排查事实。

## 扩展规则

新增命令先判断是否是传输适配；业务编排进入 `application/`，外部能力进入 `infrastructure/`，稳定数据结构进入 `domain/`。不得在命令层新增第二套导出、迁移或错误映射逻辑。
