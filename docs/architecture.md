# 架构说明

## 系统边界

绘钥是单窗口 Tauri 桌面应用，不包含账号、云同步和服务商专用协议。React WebView 只处理界面状态；模型网络请求、凭证、文件持久化和运行日志由 Rust 负责。

## 前端

- `App.tsx` 组合工作台、设置和运行日志视图，并管理生成生命周期。
- `components/` 保存界面与领域组件，测试与组件同目录。
- `lib/bridge.ts` 是唯一 IPC 入口，同时提供浏览器测试环境的本地实现。
- `lib/image.ts` 负责图片校验、缩放和缩略图生成。
- `lib/stream.ts` 使用 partial JSON 解析流式中间结果。

## Rust 后端

- `api.rs` 构建 OpenAI Chat Completions 兼容请求、解析 SSE、处理回退与取消。
- `store.rs` 管理设置、历史记录和旧版本数据迁移。
- `runtime_log.rs` 写入脱敏的 JSON Lines 运行日志。
- `lib.rs` 暴露 Tauri 命令并连接应用状态。

## 数据流

1. 前端将图片缩放后生成本次请求使用的 Data URL。
2. Rust 从 macOS 钥匙串读取 API Key，并向兼容接口发送多模态请求。
3. `started`、`delta`、`fallback` 事件通过 Tauri Channel 返回前端。
4. 前端渐进渲染部分 JSON，命令完成后以 Rust 严格解析结果为准。
5. 成功结果写入最近 50 条历史，只保存缩略图，不保存原图。

## 安全约束

- API Key 不进入 WebView、不写入普通配置和日志。
- 日志禁止记录图片、Data URL、提示词正文和模型原始响应。
- 主动停止产生的部分内容不进入历史，也不可导出。
- 公开分发需要 Developer ID 签名和 notarization；本地构建默认使用 ad-hoc 签名。
