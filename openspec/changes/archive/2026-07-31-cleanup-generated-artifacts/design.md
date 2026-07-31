## Context

参见 [proposal.md](proposal.md) 的动机说明。当前清理对象全部位于 Git 忽略范围或为空目录，但主工作区同时存在尚未提交的预设控件修复和视觉基线截图。清理必须使用明确路径清单，不能依赖会扩大匹配范围的全仓强制清理命令。

## Goals / Non-Goals

**Goals:**

- 仅删除用户已确认的 A、B 两组，以及 `artifacts/visual-review/`。
- 在删除前后记录目标大小、Git 状态和目标存在性，给出实际释放空间。
- 保持源码、当前发布产物、文档基线、OpenSpec、CodeGraph、依赖目录和未提交修改不变。
- 权限不足时停止对应目标并报告，不自动扩大权限或修改其他目录所有权。

**Non-Goals:**

- 不清理 `node_modules/`、`.codegraph/`、旧工具状态、IDE 配置或未确认的图像素材。
- 不修改 React、Rust、Tauri、SQLite、IPC、Keychain、原图和应用配置。
- 不运行全仓 `git clean`，不修改或还原现有 `.gitignore` 变更。
- 不将清理动作包装为应用功能或新增运行时清理依赖。

## Decisions

### 使用显式白名单删除

执行阶段只接受以下仓库根目录相对目标：

- `artifacts/test-results/cargo-target/`
- `artifacts/test-results/dist-root-owned-backup-20260726/`
- `artifacts/release/绘钥.app.root-owned-20260727211533/`
- `artifacts/release/绘钥.app.root-owned-20260728224746/`
- `artifacts/release/绘钥_2.0.1_aarch64.dmg`
- `artifacts/visual-review/`
- `src-tauri/target/`
- `dist/`
- `src-tauri/gen/`
- 仓库根目录 `*.tsbuildinfo`，以及排除 `node_modules/` 后的 `.DS_Store`
- 空目录 `src/shared/lib/` 与 `src/shared/ui/`

选择显式白名单是为了避免 `git clean -xfd` 连带删除当前未提交截图、依赖目录、当前发布包和其他 ignored 工具状态。若目标已不存在，按幂等清理处理，不视为失败。

### 把工作区一致性作为删除边界

执行前记录 `git status --short --branch`，执行后再次比对。由于目标均未跟踪，预期已跟踪和未跟踪工作区状态完全不变；若出现差异，应停止后续步骤并调查，不提交与清理无关的变化。

### 通过重建而不是备份恢复生成物

Cargo、Tauri、Vite 和 TypeScript 生成物不做额外备份。需要恢复时由对应构建命令重新生成。已确认的旧 App、旧 DMG 和视觉审查临时产物属于永久删除对象，不提供仓库内回收站。

### 权限问题局部失败

删除两个 root 所有的旧 App 备份时先使用当前用户权限。若失败，只将这两个目标标记为未完成并报告；不自动执行 `sudo`、递归 `chown` 或扩大到 `artifacts/release/` 的其他内容。

## Risks / Trade-offs

- [首次构建变慢] → Cargo 和前端缓存会重新生成；这是释放约 7.3 GB 空间的预期代价。
- [误删当前视觉材料] → 用户已明确确认删除整个 `artifacts/visual-review/`；长期基线仍保留在 `docs/assets/ui/current/`。
- [旧发布产物无法恢复] → 仅删除明确列出的旧版本和备份，当前 2.0.2 App、DMG 与校验文件不在白名单内。
- [权限导致部分清理失败] → 按目标记录成功与失败，不使用提权命令，也不影响其余目标。
- [并发开发改变目标内容] → 删除前重新核对路径、大小和 Git 状态；发现范围变化时停止并重新确认。

## Migration Plan

1. 在实际主工作区重新读取 Git 状态并记录白名单目标大小。
2. 核对当前发布产物和文档视觉基线不在白名单内。
3. 按白名单逐项清理，权限失败时保留目标并继续记录。
4. 清理空目录以及仓库内的 `.DS_Store`、`*.tsbuildinfo`。
5. 复核 Git 状态与清理前一致，计算实际释放空间。
6. 不主动运行完整构建；生成物清理不改变源码。执行 `git diff --check`、OpenSpec 严格校验和 `codegraph sync` 验证跟踪内容。

回滚方式：构建缓存和生成物通过后续构建重建；已确认的旧发布与临时视觉产物不可回滚，因此必须严格遵循白名单。
