# 测试策略

1.0 工作区测试覆盖 SQLite 初始化、旧历史幂等迁移、任务状态机、软删除恢复和 30 天清理。前端队列测试覆盖串行、两个并发、暂停和单项失败继续；项目 UI 覆盖多图选择和原图状态。

发布前使用 100 张受控测试图验证导入内存，并使用 1000 条本地任务验证分页和搜索。测试数据不得包含用户原图、真实提示词或凭证。

## 测试层次

- Vitest：组件状态、键盘交互、流式部分 JSON、浏览器降级序列化和历史行为。
- Rust 单元测试：URL、请求、SSE、错误映射、存储迁移、权限、原图加密和导出契约。
- Mock HTTP：认证、限流、超时、断流、兼容回退、重定向和容量上限。
- 原生冒烟：Tauri 启动、Keychain、原图、对话框和窗口行为。
- 视觉检查：`1440x900`、`1120x720` 的明暗主题及关键交互状态。

## 标准检查

```bash
npm run check
git diff --check
npm audit --omit=dev --registry=https://registry.npmjs.org
cargo audit --file src-tauri/Cargo.lock
codegraph sync
```

`npm run check` 使用临时前端输出目录，不覆盖仓库 `dist/`，并验证生产 JavaScript 依赖图没有循环加载。

## 回归要求

目录重构必须保持测试数量、IPC、构建产物 CSS 和用户可见行为一致。涉及 UI 时更新 `docs/assets/ui/current/`；仅文件移动和样式等价拆分不重复生成截图。
