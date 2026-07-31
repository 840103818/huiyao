# 安全边界

本文解释安全实现与审计方式；规范性安全场景以 [desktop-security](../../openspec/specs/desktop-security/spec.md) 为准，原图和网络容量边界分别补充在 [image-ingestion-and-originals](../../openspec/specs/image-ingestion-and-originals/spec.md) 与 [model-generation-streaming](../../openspec/specs/model-generation-streaming/spec.md)。

## 凭证与网络

- API Key 和原图加密密钥分别存入 macOS Keychain。
- Base URL 使用结构化 URL 解析，禁止用户名、密码和片段。
- 非本机 HTTP 需要对准确 Origin 确认；地址变化后重新确认。
- `reqwest::Client` 禁止自动重定向，避免凭证转发到意外主机。
- 模型请求、响应、SSE 缓冲和错误正文均有硬容量上限。

## 本地数据

- 应用数据目录权限为 `0700`，设置、历史、日志和加密原图为 `0600`。
- 原图使用随机 256 位密钥和分块 XChaCha20-Poly1305，每个文件使用独立 nonce。
- 历史只保存原图元信息，不保存路径或正文。
- `workspace.sqlite3`、WAL 和共享内存文件使用 `0600`，应用数据目录使用 `0700`。
- SQLite 错误不会向 WebView 返回数据库路径；批量导出在 Rust 临时文件中完成并原子改名。
- SQLite 写入入口限制搜索文本、文件名、缩略图、预设要求、任务选择数量和结果 JSON 容量，避免异常 IPC 载荷导致数据库或内存无界增长。
- 工作区会话 ID 使用固定字符集和 128 字节上限，避免异常 IPC 载荷写坏设置文件。
- 原图暂存提交时，Rust 会按暂存 ID 解密并重新识别真实格式、字节数、尺寸和 EXIF；WebView 回传的暂存元数据不作为配额或持久化依据。
- 旧历史与项目任务共用原图目录时，清理引用集合同时包含 `history.json` 和 SQLite 资产；SQLite 引用查询失败时采用保守策略跳过清理。
- 原图软配额默认 10 GB，达到 80% 提示，超过配额阻止归档；单次批量导入最多 100 张和 1 GB。
- ZIP 包含原图时必须显式选择，界面明确提示原图会以未加密形式导出。
- ZIP 先写入目标目录内随机命名、`0600` 且排他创建的临时文件；失败会清理临时明文，成功后再原子替换目标文件。
- 存在加密文件但密钥缺失时禁止生成新密钥覆盖。

废纸篓永久删除必须在同一 SQLite 事务内确认目标仍处于软删除状态，活动项目和任务不能绕过废纸篓直接永久删除。任务完成与失败写入同样受任务状态机约束，不能覆盖已完成结果。

## WebView

- 生产 CSP 只允许应用资源和 Tauri IPC；开发 CSP 只额外允许本机 Vite 和 WebSocket。
- WebView 不接收 API Key、原始诊断正文或任意导出路径。
- 原生保存对话框和文件写入由 Rust 完成。

## 日志与诊断

运行日志不得记录图片、提示词、优化要求、API Key、文件路径或模型正文。诊断数据写入前执行凭证、Data URL 和常见 Authorization 形式脱敏，并受到数量、字节和生存期限制。

## 审计

CI 使用官方 npm 源安装依赖，并审计生产及开发依赖；锁文件校验会拒绝第三方下载地址和缺少 `integrity` 的下载项。Cargo 测试使用 `--locked`，并执行 RustSec 审计。GitHub Actions 固定到提交 SHA，Dependabot 覆盖 npm、Cargo 和 Actions。

### macOS 目标的 `glib` 告警

`GHSA-wrw7-89jp-8q8g` 影响 `glib < 0.20.0` 的特定迭代器实现。该依赖由 Tauri 的 Linux GTK 运行时条件引入，会出现在 Cargo 跨平台锁文件中，但不进入绘钥的 `aarch64-apple-darwin` 产物。发布前用以下命令复核目标依赖图：

```bash
cargo tree --manifest-path src-tauri/Cargo.toml \
  --locked --target aarch64-apple-darwin -i glib
```

命令必须返回“未找到匹配包”，`npm run check` 也会执行同等断言；若未来支持 Linux，或 `glib` 进入 macOS 目标依赖图，必须重新打开该风险并升级相关运行时，不得沿用当前例外。
