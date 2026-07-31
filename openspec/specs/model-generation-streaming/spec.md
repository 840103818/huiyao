# model-generation-streaming Specification

## Purpose
定义绘钥连接 OpenAI Chat Completions 兼容模型、传输图片请求、接收真实 SSE、执行兼容回退、限制响应和安全取消的稳定行为。
## Requirements
### Requirement: 模型服务必须使用受控兼容端点

应用 SHALL 根据结构化 Base URL 构建 `{Base URL}/chat/completions`，使用用户配置的支持图片输入模型，并在图片反推请求中发送最长边不超过 2048 像素的请求图。

#### Scenario: 正常图片反推

- **WHEN** 用户配置有效兼容服务并启动包含原图的任务
- **THEN** 应用向受控端点发送缩放后的图片请求并开始接收真实模型事件

### Requirement: 流式传输必须优先使用真实 SSE

应用 SHALL 优先请求带 `stream_options.include_usage` 的 SSE，并通过 started、delta 和 fallback 事件传递真实状态；服务不兼容时依次回退到普通流式和非流式响应，不得伪造增量。

#### Scenario: 服务拒绝 stream options

- **WHEN** 服务仅不支持 `stream_options`
- **THEN** 应用发出 fallback 状态并重试普通 SSE，不重复创建用户任务

#### Scenario: 服务完全不支持 SSE

- **WHEN** 普通流式请求仍被服务明确拒绝
- **THEN** 应用进入非流式兼容模式并直接展示最终结果，不模拟逐字输出

### Requirement: 请求与响应必须具有硬容量上限

模型传输 SHALL 限制图片原始字节为 20 MiB、图片 Data URL 为 32 MiB、SSE 总字节为 4 MiB、累积模型正文为 1 MiB、完整响应为 2 MiB、异常正文为 256 KiB；任一上限触发时必须取消并返回脱敏错误。

#### Scenario: 无限 SSE 超过限制

- **WHEN** 服务持续发送内容并超过 SSE 或正文容量上限
- **THEN** Rust 立即停止读取、取消请求，并且 WebView 只收到稳定错误码和脱敏说明

### Requirement: 取消和断流必须保留已接收内容但不得持久化正式结果

用户停止、Channel 断开、窗口关闭或 SSE 未正常完成时，应用 SHALL 取消活动请求并展示已收到的部分提示词；部分内容可以复制，但不得保存为完成任务、正式修订或正式导出。

#### Scenario: 用户停止生成

- **WHEN** 用户在收到部分中英文提示词后停止请求
- **THEN** 打印缓冲立即追平已接收内容，任务不进入 completed，完整复制和正式导出保持禁用

### Requirement: 流式打印必须自适应且不改变真实指标

界面 SHALL 最多每 40ms 合并一次打印更新，按积压量从单字符逐步加速并限制单帧最多 48 个 Unicode 字符，完成后最多 240ms 追平；首字、字符数和耗时必须按真实 SSE 统计。

#### Scenario: 快速返回大量内容

- **WHEN** SSE 在短时间积压超过 120 个字符
- **THEN** 界面加速追赶且不会因打印动画明显延迟最终完成状态

#### Scenario: 用户启用减少动态效果

- **WHEN** 系统设置 `prefers-reduced-motion: reduce`
- **THEN** 应用关闭逐字延迟和光标闪烁，但继续显示合并后的实时内容、阶段和真实指标
