# 前端架构

## 项目工作区

`features/projects/` 管理项目任务栏、概览、批量导入和受控队列。队列并发固定为 1 或 2，单项异常由调度器隔离；只有选中任务把 SSE 增量送入完整结果组件。任务、项目和预设只能通过 `infrastructure/tauri/workspace.ts` 访问 Rust，不写入 `localStorage`。

桌面端无选中任务时显示项目概览；浏览器开发模式继续提供旧单图降级界面，用于无 Tauri 环境的组件调试。

`app/shell/WorkspaceLayout.tsx` 负责项目栏与视觉输入/结果的横向布局。它只接收渲染节点和宽度偏好，不持有项目或生成业务状态；拖动期间使用本地实时值，结束后通过 `App` 的工作区偏好更新函数持久化。范围同时在 React、浏览器降级设置和 Rust `WorkspacePreferences::normalized` 中限制。

## 模块职责

- `app/`：应用初始化、全局通知、页面切换、顶层工作台状态和 Shell。
- `features/image-input/`：图片预处理、画布、拖放、查看器及功能样式。
- `features/generation/`：生成状态反馈和流式部分 JSON 解析。
- `features/analysis/`：摄影测定、EXIF 展示和动态结果分隔。
- `features/prompts/`：提示词阅读、编辑副本、优化、比较和导出入口。
- `features/history/`：历史搜索、恢复和右键操作。
- `features/projects/`：项目、任务队列、预设、筛选、废纸篓和批量操作。
- `features/settings/`、`features/diagnostics/`：懒加载的二级页面。
- `infrastructure/tauri/`：按设置、生成、历史、原图、导出和诊断拆分 IPC。
- `shared/contracts/`：跨功能数据契约，不包含组件状态。

## 状态策略

当前规模使用 React 本地状态和功能 Hook，不引入全局状态库。`App` 只保存跨功能共享状态；面板内部展开、滚动、抽屉和编辑草稿归功能组件所有。

历史写入通过前端 Promise 队列串行化；图片预处理和历史原图加载使用任务序号避免旧任务覆盖新选择。原图在读取为 `ArrayBuffer` 前先执行 MIME 与 20 MB 容量校验，预览 Blob URL 采用显式所有权转移，并在失败、取消和后台任务完成路径释放。

项目任务列表只读取任务摘要，不携带完整结果；选中任务后再通过详情命令加载结果，队列分页不会把全部提示词正文累积到 WebView。流式增量先进入有界后端响应缓冲，再进入 `features/generation/stream.ts` 的共享打印控制器。控制器分离已接收和已显示缓冲，以 40ms 帧间隔、自适应批量和 240ms 完成期限驱动局部 JSON 解析；完成时仍以 Rust 返回的严格结果为准。

打印控制器按 Unicode 码点切分增量，积压阈值为 24 和 120 字符，单帧上限为 48 字符。反推与提示词优化复用同一实现，但各自持有独立控制器实例；停止和失败执行 `flush`，新请求与卸载执行 `reset`，避免旧定时器继续更新界面。真实接收字符数、首字时间和请求耗时由 SSE 事件维护，不使用打印进度替代。

## 样式

`styles/index.css` 保持全局加载顺序：Token、基础、Arco、Shell、功能、状态栏、运维页面、覆盖和响应式。功能 CSS 与实现共置；修改类名时必须同步组件测试和视觉基线。

全局 Token 使用纯中性灰表面，功能色只表达状态与操作。Shell 分隔器、设置分类导航和日志 Console 表面属于全局布局；项目概览、图片画布、摄影测定与提示词样式继续留在各功能目录。不得用组件内联颜色绕过明暗主题。

## 新功能放置

优先将组件、Hook、工具和测试放入所属 `features/<name>/`。只有被至少两个功能使用且没有领域归属的代码才进入 `shared/`。调用 Tauri 时通过 `infrastructure/tauri` 公共入口，不从组件直接调用 `invoke`。
