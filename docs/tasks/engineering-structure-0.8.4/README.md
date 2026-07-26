# 绘钥 0.8.4 工程结构重构记录

## 目标

在不改变产品行为、界面、IPC 和持久化格式的前提下，将前端调整为 Feature-first，将 Rust 后端调整为 DDD-lite，并建立可持续维护的工程文档体系。

## 基线

- 分支：`master`
- 版本：`0.8.4`
- 前端：58 项测试通过
- Rust：51 项测试通过
- 生产前端依赖图校验通过
- 仓库存在未提交的 0.8.2–0.8.4 修复，重构必须完整保留

## 进度

- [x] PLAN：确认目标结构、兼容边界和验证方式
- [x] IMPLEMENT：迁移前端、Rust、脚本和文档
- [x] REVIEW：检查依赖方向、兼容性、安全边界和未提交改动
- [x] TEST：执行完整检查、原生冒烟和 Apple Silicon 构建
- [x] SUMMARY：记录结果和后续建议

## 变更记录

### 2026-07-25

- 完成工作区、Git、CodeGraph 与测试基线检查。
- 确认目标目录 `/Users/oujintao/Documents/huiyao` 当前不存在。
- 前端迁移为 Feature-first，并将 Tauri Bridge、应用 Hook、跨端契约和 CSS 按职责拆分。
- Rust 迁移为 DDD-lite，拆分命令、状态、应用序列化、HTTP、持久化、图片、日志、Keychain 和原生导出。
- 将旧 AI 工具状态原样归档到 `/Users/oujintao/Documents/huiyao-tooling-archive-20260725-234432/`。
- 将发布和视觉产物统一迁入 `artifacts/`，精简非 macOS 图标。
- 重建产品、设计、工程、运维和 ADR 文档体系。
- `npm run check` 通过：前端 58 项、Rust 51 项测试成功，生产资源依赖图正常。
- npm 生产依赖审计无漏洞；RustSec 仅报告现有 Tauri 间接依赖的已允许警告。
- Tauri 原生开发模式启动成功；Apple Silicon App、DMG、ad-hoc 签名和 DMG 校验通过。
- 仓库根目录已迁移到 `/Users/oujintao/Documents/huiyao`，`master` 分支和 GitHub 远端保持不变。
- 清理了包含旧绝对路径的 Tauri 构建缓存，并在新目录再次完成全量检查。
