# 安全边界

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
- 存在加密文件但密钥缺失时禁止生成新密钥覆盖。

## WebView

- 生产 CSP 只允许应用资源和 Tauri IPC；开发 CSP 只额外允许本机 Vite 和 WebSocket。
- WebView 不接收 API Key、原始诊断正文或任意导出路径。
- 原生保存对话框和文件写入由 Rust 完成。

## 日志与诊断

运行日志不得记录图片、提示词、优化要求、API Key、文件路径或模型正文。诊断数据写入前执行凭证、Data URL 和常见 Authorization 形式脱敏，并受到数量、字节和生存期限制。

## 审计

CI 使用官方 npm 源审计生产依赖，并执行 RustSec 审计。GitHub Actions 固定到提交 SHA，Dependabot 覆盖 npm、Cargo 和 Actions。
