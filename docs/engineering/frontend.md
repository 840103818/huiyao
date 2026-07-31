# 前端架构

本文记录前端模块与状态边界。项目、图片、流式生成、摄影测定、修订和交互行为的验收契约统一索引在 [OpenSpec 规格中心](../../openspec/README.md)。

## 项目工作区

`features/projects/` 管理项目任务栏、概览、批量导入和受控队列。队列并发固定为 1 或 2，单项异常由调度器隔离；只有选中任务把 SSE 增量送入完整结果组件。任务、项目和预设只能通过 `infrastructure/tauri/workspace.ts` 访问 Rust，不写入 `localStorage`。

预设编辑 Modal 内的 Select 使用 `preset-editor-select-popup` 提升弹层，确保详细程度和自动优化选项始终位于全局 Modal 遮罩之上；控件通过明确的无障碍名称参与键盘和自动化操作。

桌面端无选中任务时显示项目概览；浏览器开发模式继续提供旧单图降级界面，用于无 Tauri 环境的组件调试。开发环境还支持脱敏工作区视觉预览：`workspace-preview=1` 显示项目概览，`workspace-preview=task` 显示完整任务结果，`workspace-preview=streaming` 显示生成中间态；`theme-preview=light|dark` 固定截图主题，`interaction-preview=refinement|compare` 打开专业精修关键状态。这些入口只在 `import.meta.env.DEV` 下启用，不调用模型、Keychain、SQLite 或原图接口。

`app/shell/WorkspaceLayout.tsx` 负责项目栏与视觉输入/结果的横向布局。它只接收渲染节点和宽度偏好，不持有项目或生成业务状态；拖动期间使用本地实时值，结束后通过 `App` 的工作区偏好更新函数持久化。范围同时在 React、浏览器降级设置和 Rust `WorkspacePreferences::normalized` 中限制。

## 模块职责

- `app/`：应用初始化、全局通知、页面切换、顶层工作台状态和 Shell。
- `features/image-input/`：图片预处理、画布、拖放、查看器及功能样式。
- `features/generation/`：生成状态反馈和流式部分 JSON 解析。
- `features/analysis/`：摄影测定、EXIF、动态结果分隔、统一修订、校正与比较。
- `features/prompts/`：提示词阅读、平台优化和导出入口；版本切换与比较统一由分析功能的修订栏承载。
- `features/history/`：历史搜索、恢复和右键操作。
- `features/projects/`：项目、任务队列、预设、筛选、废纸篓和批量操作。
- `features/settings/`、`features/diagnostics/`：懒加载的二级页面。
- `infrastructure/tauri/`：按设置、生成、历史、原图、导出和诊断拆分 IPC。
- `shared/contracts/`：跨功能数据契约，不包含组件状态。

## 状态策略

当前规模使用 React 本地状态和功能 Hook，不引入全局状态库。`App` 只保存跨功能共享状态；面板内部展开、滚动、抽屉和编辑草稿归功能组件所有。

顶栏只在非空闲状态渲染运行状态与真实耗时，底部状态栏只渲染已有指标。图片画布复用 `ProcessingStatus` 的 `compact` 展示模式；该模式仅改变组件结构与样式，不建立新的生成状态或跨端契约。

历史写入通过前端 Promise 队列串行化；图片预处理和历史原图加载使用任务序号避免旧任务覆盖新选择。原图在读取为 `ArrayBuffer` 前先执行 MIME 与 20 MB 容量校验，预览 Blob URL 采用显式所有权转移，并在失败、取消和后台任务完成路径释放。

项目任务列表只读取任务摘要，不携带完整结果；选中任务后再通过详情命令加载结果，队列分页不会把全部提示词正文累积到 WebView。流式增量先进入有界后端响应缓冲，再进入 `features/generation/stream.ts` 的共享打印控制器。控制器分离已接收和已显示缓冲，以 40ms 帧间隔、自适应批量和 240ms 完成期限驱动局部 JSON 解析；完成时仍以 Rust 返回的严格结果为准。

打印控制器按 Unicode 码点切分增量，积压阈值为 24 和 120 字符，单帧上限为 48 字符。反推与提示词优化复用同一实现，但各自持有独立控制器实例；停止和失败执行 `flush`，新请求与卸载执行 `reset`，避免旧定时器继续更新界面。真实接收字符数、首字时间和请求耗时由 SSE 事件维护，不使用打印进度替代。

## 统一修订状态

`features/analysis/revisions.ts` 是前端统一修订的唯一转换入口。它负责旧 `PromptVersion` 懒转换、活动修订解析、12 个派生修订上限、派生链级联删除影响和当前视图投影。基础 `ReverseResult.analysis/prompts` 不被派生操作覆盖。

`RevisionBar` 持有校正、比较和提示词编辑 Drawer 的临时状态。人工字段修改自动加入 `lockedFields`；AI 重测的 SSE 增量通过共享打印控制器更新草稿，完成后以后端严格结果为准。结果保存仍通过顶层 `onResultChange` 进入串行的任务结果更新命令，组件不直接访问 SQLite。

## 样式

`styles/index.css` 保持全局加载顺序：Token、基础、Arco、Shell、功能、状态栏、运维页面、覆盖和响应式。功能 CSS 与实现共置；修改类名时必须同步组件测试和视觉基线。

全局 Token 使用纯中性灰表面，功能色只表达状态与操作。8/12/16/24px 间距、32–36px 控件和 42–44px 面板标题栏由语义样式统一约束。Shell 分隔器、设置分类导航和日志 Console 表面属于全局布局；项目概览、图片画布、摄影测定与提示词样式继续留在各功能目录。不得用组件内联颜色绕过明暗主题。

项目栏密度、项目概览连续布局、摄影测定行高和提示词阅读宽度分别由 `features/projects/projects.css`、`features/analysis/analysis.css` 与 `features/prompts/prompts.css` 维护。结果完成状态不在多个面板重复渲染；统一修订栏只常驻版本、同步状态和“更多”入口，危险删除通过组件内 Modal 明确确认并保留级联影响说明。

摄影测定分组定位由 `ResultPanel` 的 `analysis-group-nav` 承载，继续使用 Arco `Radio.Group` 的语义和键盘行为；视觉覆盖仅位于 `features/analysis/analysis.css`，四段等宽并复用全局表面、边框和焦点 Token，不在组件内写入主题颜色。

设置分类导航由页面内 `IntersectionObserver` 跟踪当前区段，卸载时必须断开观察器；日志工具栏保持筛选组和操作组两个稳定容器，由响应式样式决定是否换行。

图片查看器由独立的 `ImageViewer` 组件负责，`viewerGeometry` 只保存无 DOM 依赖的适应比例、真实像素缩放、平移边界和导航器映射。查看器使用绝对显示比例而不是相对适应比例；高频指针、滚轮和导航器移动通过 `requestAnimationFrame` 合并，渲染只更新 `translate3d + scale`。导航缩略图复用已经加载的图片地址，不重新读取原图或调用 IPC。

原生窗口装饰切换在 Tauri 设置桥接层串行执行。组件挂载同步请求隐藏，卸载同步请求恢复，禁止等待旧请求完成后再恢复，以免快速关闭和重新打开留下错误的最终窗口状态。

macOS WebKit 的进程异常恢复界面不属于 React DOM，语言由应用包元数据决定。`src-tauri/Info.plist` 将 `CFBundleDevelopmentRegion` 设为 `zh_CN`，并声明 `zh-Hans` 本地化；不要在前端增加无法覆盖系统错误页的伪恢复按钮。

## 新功能放置

优先将组件、Hook、工具和测试放入所属 `features/<name>/`。只有被至少两个功能使用且没有领域归属的代码才进入 `shared/`。调用 Tauri 时通过 `infrastructure/tauri` 公共入口，不从组件直接调用 `invoke`。
