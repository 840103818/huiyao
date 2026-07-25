# 架构说明

## 系统边界

绘钥是单窗口 Tauri 桌面应用，不包含账号、云同步和服务商专用协议。React WebView 只处理界面状态；模型网络请求、凭证、文件持久化和运行日志由 Rust 负责。

## 前端

- `App.tsx` 组合工作台、设置和运行日志视图，并管理生成生命周期。
- `components/` 保存界面与领域组件，测试与组件同目录。
- `lib/bridge.ts` 是唯一 IPC 入口，同时提供浏览器测试环境的本地实现。
- `lib/image.ts` 在 Rust 尺寸预检后请求系统解码器按 2048px 目标尺寸解码，并异步生成请求图和缩略图。
- `lib/stream.ts` 使用 partial JSON 解析流式中间结果。
- `components/ProcessingStatus.tsx` 将真实请求状态、SSE 字符增量和耗时映射为生成/优化阶段反馈，不推算虚假百分比。
- `Toolbar` 固定导航、品牌和版本布局；版本直接读取 `package.json`，避免界面硬编码漂移。
- `ImageWorkbench` 管理主画布、面板内参数抽屉、拖入替换、指针中心缩放和有边界的平移。
- `PromptPanel` 管理只读基础/优化版本、手工派生版本和双栏版本比较；版本变更统一经 `App.tsx` 的串行历史写入队列持久化。
- 设置页和日志页通过 `React.lazy` 按需加载；Vite 将 Arco、React 与 Tauri 运行时代码拆分为独立生产分块。

## Rust 后端

- `api.rs` 构建 OpenAI Chat Completions 兼容请求、解析 SSE、处理回退与取消。
- `original_image.rs` 校验原始图片、提取 EXIF 白名单，并使用分块 XChaCha20-Poly1305 管理加密暂存、归档、读取和事务式清理。
- `store.rs` 管理设置、历史记录和旧版本数据迁移。
- `runtime_log.rs` 写入脱敏的 JSON Lines 运行日志。
- `lib.rs` 暴露 Tauri 命令并连接应用状态。

## 数据流

1. 前端保留原始 `File`；桌面端先通过 Raw IPC 将原始字节送到 Rust，Rust 复验格式和尺寸并返回 EXIF 白名单。
2. 前端要求系统图片解码器按 2048px 目标尺寸解码，生成模型请求图和 320px 缩略图；Rust 同时使用 Keychain 中的独立 256 位密钥加密暂存原始字节。
3. Rust 从 macOS 钥匙串读取 API Key，并向兼容接口发送多模态请求。
4. `started`、`delta`、`fallback` 事件通过 Tauri Channel 返回前端，前端渐进渲染部分 JSON。
5. 命令完成后以 Rust 严格解析结果为准；保存历史时在同一存储锁中归档密文并写入索引。
6. 恢复历史时先显示缩略图，再异步解密原图；提示词二次优化只发送文本上下文，不再次发送图片。
7. 手工编辑保存为带 `origin/sourceVersionId/title` 的派生版本；基础结果和模型优化版本保持只读，旧版本缺少 `origin` 时按模型优化版本迁移。

## 交互状态流

- 生成状态沿用 `GenerationState`；`started` 事件表示请求已经交给模型服务，首个 `delta` 才进入真实流式解析。
- 等待首字 8 秒和 20 秒提示只依据本地单调累计耗时；停止、失败、完成或断流时立即结束循环动画。
- 流式字符数取已收到的 SSE 正文长度，摄影测定完成数取当前 partial JSON 中非空字段，不代表服务端完成百分比。
- 结果区在流式阶段冻结自动分隔比例，最终结果到达后仅重新测量一次。
- 提示词优化复用相同阶段组件；部分优化结果可复制，但只有命令成功并保存为版本后才能复制完整结果或导出。
- 流式增量先进入内存缓冲，再通过 `requestAnimationFrame` 合并 partial JSON 解析和 React 更新，避免每个 Token 触发渲染。
- 模型请求由共享 `reqwest::Client` 执行，并通过信号量限制最多 2 个并发；Channel 断开或窗口关闭会取消对应请求。

## 完整结果格式

- `src/lib/bridge.ts` 的 `toMarkdown` 用于剪贴板、历史右键和浏览器降级导出。
- Rust 的 `result_markdown/result_json/result_text` 用于原生保存对话框导出；两端必须同步覆盖摄影测定、EXIF 白名单、活动提示词版本、SDXL 负面提示词和元数据。
- `createdAt` 在展示/导出时转换为本地时间 `yyyy-MM-dd HH:mm:ss`；无效值输出 `--`，存储结构仍保留 RFC 3339 原值。

## 安全约束

- API Key 不进入 WebView、不写入普通配置和日志。
- 原图加密密钥使用独立 Keychain 项；存在密文但密钥缺失时禁止生成新密钥覆盖。
- 历史只保存原图元数据，不保存原图路径、字节或 Data URL；原图目录和文件分别使用 `0700`、`0600` 权限。
- EXIF 只保留相机与曝光相关白名单；GPS、设备序列号、作者、版权和备注不会离开 Rust 解析边界。
- 原图读取、解密、加密和导出写入使用阻塞任务；清理全部原图先隔离密文，索引写入失败时恢复原文件。
- 日志禁止记录图片、Data URL、提示词正文和模型原始响应。
- 主动停止产生的部分内容不进入历史，也不可导出。
- 公开分发需要 Developer ID 签名和 notarization；本地构建默认使用 ad-hoc 签名。
