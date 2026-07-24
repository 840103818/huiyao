# 绘钥

绘钥是一款面向 macOS 的图片反向提示词工作台。应用通过 OpenAI Chat Completions 兼容接口分析图片，并以流式方式输出视觉测定、中英文提示词和请求诊断信息。

## 功能

- PNG、JPEG、WebP 图片选择与拖放，发送前自动缩放至最长边 2048px。
- 视觉要素、中英文提示词和令牌信息实时解析。
- 生成停止、复制、Markdown 导出和最近 50 条历史记录。
- 历史记录搜索、删除、右键复制和标题修改。
- macOS 钥匙串存储 API Key，运行日志默认脱敏。
- 跟随系统、浅色和深色三种主题。

## 技术栈

- React 18、TypeScript、Vite、Vitest
- Arco Design React
- Tauri 2、Rust、reqwest
- OpenAI Chat Completions 兼容 SSE 协议

## 快速开始

环境要求：macOS 12 或更高版本、Node.js 20.19+、npm 10+、Rust stable。

```bash
npm ci
npm run dev:desktop
```

首次运行后，在应用设置页填写 `Base URL`、`API Key` 和模型名。凭证不会写入仓库或普通配置文件。

## 常用命令

```bash
npm run dev               # 启动前端开发服务器
npm run dev:desktop       # 启动 Tauri 桌面应用
npm test                  # 运行前端测试
npm run check             # 运行前端、Rust 全量检查
npm run build:macos:arm64 # 构建 Apple Silicon 安装包
npm run verify:release    # 验证 release 目录中的应用与 DMG
```

## 项目结构

```text
.
├── .github/          # CI 与协作模板
├── docs/             # 架构、开发和发布文档
├── scripts/          # 检查、构建和产物验证脚本
├── src/              # React 前端与同目录测试
├── src-tauri/        # Rust 后端、Tauri 配置和应用图标
├── AGENTS.md         # AI 编码代理的项目约定
├── package.json      # 前端依赖和统一命令入口
└── README.md
```

更详细的说明见 [架构文档](docs/architecture.md)、[开发指南](docs/development.md) 和 [发布指南](docs/release.md)。

## 安全

禁止在代码、日志、截图和问题描述中提交 API Key、访问令牌、图片 Data URL 或模型完整原始响应。安全问题请参阅 [SECURITY.md](SECURITY.md)。

## 许可证

本项目使用 [Apache License 2.0](LICENSE)。
