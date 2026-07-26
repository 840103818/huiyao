# 绘钥 1.0.0 数字暗房工作台

## 2026-07-26 PLAN

- 在独立分支 `feature/1.0.0-digital-darkroom` 实施，不自动合并 `master`。
- 保持现有流式协议、原图加密格式、Keychain 服务和 Bundle ID。
- 使用 SQLite 管理项目、任务、标签、预设和废纸篓；旧历史幂等迁移并保留回退文件。
- 前端增加项目任务栏、批量导入、受控队列、项目概览、筛选和批量导出。

## 2026-07-26 IMPLEMENT

- 新增 `workspace.sqlite3` Schema、WAL/外键、私有权限、历史迁移和 30 天废纸篓。
- 新增项目、任务、预设、收藏标签、顺序/移动、队列进度、原图和 ZIP 导出 IPC。
- 新增最多两个并发的任务调度器；暂停不取消当前项，停止取消活动请求，单项失败继续。
- 新增项目任务栏、项目概览、批量导入取消、预设复制编辑、批量操作和 `Cmd+K`。
- 版本同步为 `1.0.0`。

## REVIEW / TEST

- Rust 数据库错误对 WebView 隐藏本地路径；数据库及 WAL 文件保持私有权限。
- SQLite 工作区补充任务选择、搜索、文件名、缩略图、预设和结果 JSON 容量限制，防止异常 IPC 载荷造成无界增长。
- `npm run check` 通过：前端 63 项、Rust 56 项测试全部通过，生产前端构建及依赖循环检查通过。
- `npm audit --omit=dev --registry=https://registry.npmjs.org` 通过，生产依赖 0 个已知漏洞；`cargo audit` 因 RustSec 数据库网络拉取失败未完成。
- Browser Skill 未连接浏览器，按约定回退工作区 Playwright；已检查 `1440x900` 浅色、`1120x720` 深色、项目概览、废纸篓和设置页，无横向溢出、重叠、截断或浏览器错误。
- 已覆盖更新 `docs/assets/ui/current/` 的工作台双主题截图，并新增废纸篓和设置页关键交互截图，全部使用本地测试数据。
- `cargo tauri dev` 原生冒烟通过，应用进程稳定启动且无启动错误。
- Apple Silicon 生产包构建与校验通过：版本 `1.0.0`、Bundle ID `com.huiyao.studio`、arm64、应用图标、ad-hoc 签名和 DMG 校验均正常。
- 交付分支为 `feature/1.0.0-digital-darkroom`，不自动合并 `master`，由用户人工检查后合并。
- 用户明确授权后已将功能分支与 `origin/master` 合并；远端先后升级 React 相关依赖，最终统一采用 React 19 对齐版本。按新锁文件执行 `npm ci`、前端 63 项和 Rust 56 项测试均通过。
