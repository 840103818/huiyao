# 当前界面基线

本目录保存当前版本的脱敏视觉基线。工作台使用内置项目、任务和预设测试数据；截图不包含凭证、用户图片、真实模型正文或本机路径。

本轮 Apple 原生极简重构的核心基线：

- `workspace-light-1440x900.png`：宽屏浅色项目概览与固定项目栏。
- `workspace-dark-1120x720.png`：最小窗口深色项目概览。
- `project-drawer-dark-1120x720.png`：窄屏项目任务 Drawer。
- `selected-task-light-1440x900.png`：完整摄影测定与提示词结果工作台。
- `settings-dark-1120x720.png`：分类导航与固定保存区。
- `logs-light-1440x900.png`：Console 风格日志页与空状态。
- `settings-http-confirm-light-1440x900.png`：明文 HTTP 风险确认。
- `generation-stream-light-1440x900.png`、`generation-stream-dark-1120x720.png`：双尺寸、双主题下的反推 SSE 打印状态。
- `prompt-optimization-light-1440x900.png`、`prompt-optimization-dark-1120x720.png`：双尺寸、双主题下的提示词优化流式状态。

其余图片记录视觉输入、流式生成、摄影测定、提示词优化、版本比较、EXIF、废纸篓和图片查看器等关键交互。页面样式变化影响对应状态时必须同步覆盖。
