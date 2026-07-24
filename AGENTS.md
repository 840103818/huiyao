# AGENTS.md

## 项目目标

绘钥是 React + TypeScript + Tauri 2 构建的 macOS 图片反向提示词工具。前端负责交互和流式局部 JSON 展示，Rust 负责模型请求、取消、日志、历史持久化和钥匙串访问。

## 开始修改前

1. 阅读 `README.md` 和 `docs/architecture.md`。
2. 仓库存在 `.codegraph/` 时，优先使用 `codegraph explore` 定位调用链。
3. 检查工作区状态，不覆盖用户尚未提交的改动。
4. 不读取、输出或提交 API Key、Token、钥匙串内容、图片 Data URL 和模型原始正文。

## 目录边界

- `src/components/`：界面与领域组件。
- `src/lib/`：Tauri bridge、图片预处理和流式 JSON 解析。
- `src-tauri/src/`：模型传输、存储、日志和 Tauri 命令。
- `src-tauri/icons/`：应用图标源文件与生成尺寸。
- `docs/`：长期有效的架构、开发和发布约定。
- `output/`、`release/`：本地产物，禁止提交。

## 实现规则

- 优先复用现有 Arco Design 组件、语义化 Token 和 IPC 接口。
- 不在 WebView 中持久化 API Key，不在日志中记录请求正文或模型响应正文。
- 流式协议、历史结构和设置结构变更必须同时更新 TypeScript、Rust 和测试。
- 用户可见文本默认使用简体中文；模型名、请求 ID、`API Key`、`Base URL` 等技术标识可保留英文。
- 修改范围保持聚焦，不引入未被需求证明需要的抽象和依赖。

## 完成标准

```bash
npm run check
codegraph sync
```

界面修改还需检查 `1440x900` 和 `1120x720` 的明暗主题。发布变更按 `docs/release.md` 构建并验证 Apple Silicon 产物。
