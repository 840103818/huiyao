# 贡献指南

## 开发流程

1. 从最新 `master` 创建功能分支。
2. 新功能、跨层改动、数据迁移、安全调整和大范围 UI 重构先通过 OpenSpec 创建并确认 change；小型修复可直接实施。
3. 保持改动聚焦，并为行为变化补充测试。
4. 同步对应用户说明和技术说明；页面变化需覆盖脱敏视觉基线。
5. 提交前运行 `npm run check`、`git diff --check` 和 `codegraph sync`。
6. 在 Pull Request 中说明用户影响、OpenSpec change、验证方式和界面截图。

复杂变更的标准入口：

```text
$openspec-explore
$openspec-propose "变更描述"
$openspec-apply-change
$openspec-archive-change
```

`openspec/specs/` 保存当前稳定行为，`openspec/changes/` 保存活动增量和归档。既有 `docs/tasks/` 只作为历史记录保留。

推荐提交信息使用以下前缀：

- `feat:` 新功能
- `fix:` 缺陷修复
- `refactor:` 不改变行为的重构
- `test:` 测试调整
- `docs:` 文档调整
- `build:` 构建或依赖调整

## 兼容与安全

- 最低支持 macOS 12，主构建目标为 Apple Silicon。
- 不提交 `.env`、API Key、访问令牌、用户图片、运行日志和 `artifacts/` 安装包。
- 修改 IPC、存储或历史结构时，需要说明迁移和向后兼容策略。
- 界面修改需验证浅色、深色、最小窗口尺寸和键盘操作。
