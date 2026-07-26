# 绘钥

绘钥是使用 React、TypeScript、Arco Design 和 Tauri 2 构建的 macOS 图片反向提示词工作台。应用从图片提取摄影测定结果，生成中英文提示词，并支持流式输出、提示词精修、历史记录、原图加密保存和运行诊断。

当前版本：`0.8.4`；Bundle ID：`com.huiyao.studio`；主要发布目标：Apple Silicon、macOS 12 及以上。

![绘钥工作台](docs/assets/ui/current/workspace-light-1440x900.png)

## 快速开始

```bash
npm ci
npm run dev:desktop
```

首次使用时在“设置”中配置 OpenAI Chat Completions 兼容服务的 `Base URL`、`API Key` 和模型名。浏览器开发模式用于界面调试，不支持模型请求、Keychain、原图加密和原生导出。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev:desktop` | 启动 Tauri 桌面开发环境 |
| `npm run dev` | 仅启动前端界面 |
| `npm test` | 运行前端测试 |
| `npm run build` | 类型检查并构建前端 |
| `npm run check` | 运行前端、Rust 和生产资源完整检查 |
| `npm run package:macos` | 完整检查并构建 Apple Silicon 安装包 |
| `npm run package:macos -- --fast` | 跳过完整检查并快速打包 |
| `npm run verify:release` | 验证 `artifacts/release/` 中的 App 和 DMG |

## 工程结构

```text
src/
  app/                 应用装配、Shell 和顶层状态
  features/            图片、生成、分析、提示词、历史、设置、诊断
  infrastructure/      Tauri IPC 与浏览器降级实现
  shared/              跨功能契约和共享能力
  styles/              Token、基础样式、Arco 覆盖和 Shell 样式
src-tauri/src/
  commands/            Tauri 命令适配与注册
  application/         应用用例与结果序列化
  domain/              跨端领域模型和错误契约
  infrastructure/      HTTP、存储、图片、日志、Keychain 和原生能力
docs/                  产品、设计、工程、运维、ADR 和界面基线
artifacts/             本地发布、视觉检查和测试产物，不提交 Git
```

依赖方向、模块边界和数据流参见[架构说明](docs/engineering/architecture.md)。

## 文档导航

- [产品与使用说明](docs/product/overview.md)
- [界面设计系统](docs/design/ui-system.md)
- [交互规范](docs/design/interaction.md)
- [总体架构](docs/engineering/architecture.md)
- [前端架构](docs/engineering/frontend.md)
- [后端架构](docs/engineering/backend.md)
- [IPC 契约](docs/engineering/ipc-contracts.md)
- [安全边界](docs/engineering/security.md)
- [测试策略](docs/engineering/testing.md)
- [开发指南](docs/operations/development.md)
- [发布指南](docs/operations/release.md)
- [故障排查](docs/operations/troubleshooting.md)
- [架构决策记录](docs/adr/README.md)

## 安全与数据

- API Key 仅保存在 macOS Keychain，不写入 WebView、本地 JSON 或运行日志。
- 模型请求禁止自动重定向；非本机明文 HTTP 地址需要按 Origin 明确确认。
- 原图使用独立 Keychain 密钥和 XChaCha20-Poly1305 加密后保存在应用私有目录。
- 日志不记录图片、提示词正文、API Key 或模型原始正文。
- 结果、日志、诊断和原图通过 Rust 原生保存对话框导出，WebView 不接收任意文件路径。

完整约束参见[安全说明](docs/engineering/security.md)和[安全策略](SECURITY.md)。

## 贡献

修改前阅读 [AGENTS.md](AGENTS.md) 和 [CONTRIBUTING.md](CONTRIBUTING.md)。不要提交凭证、用户图片、运行日志、`dist/`、`artifacts/` 或 Tauri 构建产物。

本项目使用 [MIT License](LICENSE)。
