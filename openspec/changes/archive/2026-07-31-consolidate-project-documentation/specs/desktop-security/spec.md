## Purpose

定义绘钥在凭证、模型网络、本地数据、WebView、日志诊断、容量限制和危险操作方面必须维持的桌面安全边界与失败原则。

## ADDED Requirements

### Requirement: 凭证必须限制在原生安全边界

API Key 和原图加密密钥 SHALL 分别存储于 macOS Keychain，不得写入 WebView、本地设置文件、日志、OpenSpec 产物或导出结果。

#### Scenario: 保存模型设置

- **WHEN** 用户保存包含新 API Key 的模型配置
- **THEN** 原生端完成可回滚的 Keychain 与设置更新，WebView 后续只能读取不含密钥的公共设置

### Requirement: 模型 URL 必须结构化校验并阻止凭证转发

Base URL SHALL 禁止用户名、密码和片段；非本机 HTTP 必须针对准确 Origin 明确确认且地址变化后重新确认，模型客户端必须禁止自动重定向。

#### Scenario: HTTPS 服务跨域重定向

- **WHEN** 模型端点返回指向不同 Origin 的重定向
- **THEN** 请求被阻止并显示明确重定向错误，API Key 不发送到目标地址

#### Scenario: 保存非本机 HTTP 地址

- **WHEN** 用户测试或保存未确认的明文 HTTP Origin
- **THEN** 应用显示可见风险确认，未确认前不得发送模型凭证

### Requirement: 本地敏感数据必须使用私有权限和认证加密

应用数据目录 SHALL 使用 `0700`，设置、SQLite、日志和加密原图文件 SHALL 使用 `0600`；原图必须使用分块认证加密，篡改或错误密钥不得返回部分明文。

#### Scenario: 加密原图被篡改

- **WHEN** 任一密文分块或认证信息发生变化
- **THEN** 解密整体失败，应用不向 WebView 返回任何未经认证的原图字节

### Requirement: WebView 必须保持最小权限

生产 CSP SHALL 只允许应用资源和 Tauri IPC，开发环境只额外允许本机 Vite 与 WebSocket；WebView 不得接收 API Key、原始诊断、数据库路径、原图路径或任意保存路径。

#### Scenario: 生产 WebView 加载外部脚本

- **WHEN** 页面尝试从未授权网络来源加载脚本或资源
- **THEN** CSP 阻止加载且不扩大 Tauri capability

### Requirement: 日志与诊断必须脱敏且有界

运行日志和诊断 SHALL 不记录图片、提示词、优化要求、模型正文、API Key 或文件路径；导出前必须脱敏 Authorization、凭证和 Data URL，并限制条目数量、总字节和生存期。

#### Scenario: 服务返回包含凭证形态的错误正文

- **WHEN** 原始异常响应包含 Authorization 或类似密钥片段
- **THEN** WebView、日志和诊断导出只包含截断且脱敏后的信息

### Requirement: 危险操作必须明确确认并保持事务一致

永久删除、清空废纸篓、清理全部原图、替换未保存结果和删除有后代的修订 SHALL 使用可见确认；涉及数据库与文件的永久删除必须通过隔离、事务校验和失败回滚避免索引与原图不一致。

#### Scenario: 永久删除文件失败

- **WHEN** 数据库事务准备完成但原图最终清理失败
- **THEN** 应用保留可恢复隔离状态或回滚索引，不得产生指向错误资产的新引用

### Requirement: 依赖与目标产物必须持续审计

工程验证 SHALL 使用官方 npm 源、锁文件完整性校验、npm audit、RustSec 审计和固定 SHA 的 GitHub Actions；仅在依赖未进入 Apple Silicon 目标图且有记录时允许平台特定例外。

#### Scenario: glib 出现在 Apple Silicon 目标图

- **WHEN** 依赖检查发现 `glib` 进入 `aarch64-apple-darwin` 构建图
- **THEN** `npm run check` 失败并要求重新评估现有 RustSec 例外
