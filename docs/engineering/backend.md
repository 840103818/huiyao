# Rust 后端架构

## SQLite 工作区

`infrastructure/persistence/workspace.rs` 是项目数据的唯一持久化入口。它负责 Schema、WAL/外键、分页搜索、状态机、标签、预设、软删除和旧历史迁移。Tauri 适配位于 `commands/workspace.rs`，ZIP 编排位于 `application/workspace_export.rs`。

数据库只保存结构化 JSON 和原图资产 ID。加密字节继续由 `infrastructure/images/` 管理，Keychain 服务名和原图文件格式保持不变。

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

## 错误与日志

命令返回结构化 `CommandError`。供应商响应正文只进入有界、脱敏、短期诊断缓存，不返回 WebView，也不写运行日志。日志只记录错误码、请求 ID、长度、阶段、耗时和兼容回退等排查事实。

## 扩展规则

新增命令先判断是否是传输适配；业务编排进入 `application/`，外部能力进入 `infrastructure/`，稳定数据结构进入 `domain/`。不得在命令层新增第二套导出、迁移或错误映射逻辑。
