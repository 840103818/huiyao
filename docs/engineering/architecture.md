# 总体架构

本文解释 React、Tauri、Rust、SQLite、Keychain 和模型服务如何实现系统能力；可观察行为由 [OpenSpec 当前规格](../../openspec/README.md)定义，架构变更不得绕过对应 capability delta。

## 系统边界

```mermaid
flowchart LR
  UI["React / Arco 工作台"] --> Bridge["Tauri Bridge"]
  Bridge --> Commands["Tauri Commands"]
  Commands --> Application["Application 用例"]
  Commands --> Domain["Domain 契约"]
  Commands --> Infra["Infrastructure"]
  Infra --> API["OpenAI 兼容模型服务"]
  Infra --> Disk["应用私有目录"]
  Infra --> Keychain["macOS Keychain"]
  Infra --> Dialog["原生文件对话框"]
```

WebView 只处理交互、图片预览和部分 JSON 展示。模型凭证、网络请求、原图加密、持久化和任意文件写入均位于 Rust 边界内。

## 2.0 工作区数据流

```mermaid
flowchart LR
  Import["批量导入"] --> Stage["Raw IPC 暂存与校验"]
  Stage --> Encrypt["XChaCha20-Poly1305 原图归档"]
  Encrypt --> SQLite["workspace.sqlite3 任务事务"]
  SQLite --> Queue["前端并发受控队列"]
  Queue --> Stream["复用 SSE 反推与优化"]
  Stream --> SQLite
  Stream --> Revision["统一结果修订"]
  Revision --> SQLite
  SQLite --> Export["Rust ZIP / 原生保存对话框"]
```

数据库不保存原图路径或正文，只保存资产 ID 与白名单元数据。任务队列默认并发 1、最多 2；只有当前选中任务渲染完整 SSE 增量，后台任务仅更新轻量状态。

## 前端依赖方向

```text
app -> features -> infrastructure/shared
app -> infrastructure/shared
infrastructure -> shared/contracts
shared -X-> app/features
```

`app/` 负责装配和页面路由；`features/` 按业务能力聚合；`infrastructure/tauri/` 是跨进程边界；`shared/` 不依赖具体功能。详见[前端架构](frontend.md)。

## Rust 依赖方向

```text
bootstrap -> commands -> application/domain/infrastructure
application -> domain
infrastructure -> domain
domain -X-> tauri
```

命令文件按设置、生成、存储、导出和运行装配拆分。为保持 Tauri 宏名称和内部辅助函数兼容，命令与部分基础设施通过 `include!` 组成单一模块命名空间；新增业务逻辑优先进入 `application/`，不得继续扩张命令适配层。

## 反推数据流

1. 前端校验格式并生成预览、缩略图和最长边 2048px 的模型输入。
2. 桌面端通过 Raw IPC 将原图字节暂存到 Rust 加密区。
3. `reverse_prompt_stream` 获取请求槽、读取设置和 Keychain API Key。
4. HTTP 基础设施构建多模态请求并解析 SSE；Channel 只传递 started、delta 和 fallback。
5. 前端打印控制器以 40ms 为上限合并更新，基于积压量自适应展示增量并解析部分 JSON；SSE 完成后最多 240ms 收尾，最终以 Rust 严格解析结果为准。
6. 结果与原图提交在历史写入锁内完成；失败时结果保留并提供重试。

## 兼容边界

- Tauri 命令名、Channel 事件和 camelCase 序列化字段是稳定接口。
- `PublicSettings`、`WorkspacePreferences`、`HistoryItem` 和 `ReverseResult` 使用 serde 默认值兼容旧数据。
- `Project`、`ProjectTask`、`ReversePreset` 和 `TrashEntry` 由 SQLite 管理；旧历史命令仅用于迁移兼容。
- `ResultRevision` 保存在任务现有 `result_json` 中，不增加 SQLite 表；旧 `promptVersions` 兼容读取并在首次派生时幂等转换。
- Keychain 服务名、应用数据目录和 Bundle ID 不因代码目录调整而变化。
- 浏览器降级序列化与 Rust 原生导出必须保持同一 schema。
