## 1. 清理前验证

- [x] 1.1 在主工作区记录 `git status --short --branch`，确认预设控件修复和两张当前截图仍完整存在。
- [x] 1.2 逐项记录清理白名单的存在性、所有权和磁盘占用，并确认当前 2.0.2 发布产物与 `docs/assets/ui/current/` 不在删除范围。
- [x] 1.3 在删除构建缓存前执行 `npm run check`，保存完整检查结果。

## 2. 生成物与缓存清理

- [x] 2.1 删除 `artifacts/test-results/cargo-target/` 和 `src-tauri/target/`，确认仅损失可重建的 Cargo 缓存。
- [x] 2.2 删除 `dist/`、`src-tauri/gen/` 和仓库根目录 `*.tsbuildinfo`，确认目标均为被忽略的生成物且不触碰 `node_modules/`。
- [x] 2.3 删除排除 `node_modules/` 后的仓库 `.DS_Store`，并仅在为空时删除 `src/shared/lib/` 与 `src/shared/ui/`。

## 3. 已确认产物清理

- [x] 3.1 删除 `artifacts/test-results/dist-root-owned-backup-20260726/`，记录实际释放空间。
- [x] 3.2 分别删除两个明确列出的 root-owned 旧 App 备份；当前权限失败时保留失败目标并报告，不使用 `sudo` 或扩大所有权修改范围。

> 已解决：用户修复所有权后，三个剩余目标均使用当前用户权限删除，未使用 `sudo` 或扩大清理范围。

- [x] 3.3 删除 `artifacts/release/绘钥_2.0.1_aarch64.dmg`，复核当前 2.0.2 App、DMG 与校验文件仍存在。
- [x] 3.4 删除整个 `artifacts/visual-review/`，复核长期视觉基线 `docs/assets/ui/current/` 未发生变化。

## 4. Review 与验证

- [x] 4.1 比对清理前后的 Git 状态，确认未提交业务修改、当前截图和 `.gitignore` 状态没有变化。
- [x] 4.2 复核白名单目标已删除或被明确记录为权限失败，并计算总释放空间。
- [x] 4.3 执行 `git diff --check`、OpenSpec 严格校验和 `codegraph sync`，确认跟踪文件及规格状态有效。
- [x] 4.4 在实施总结中列出已删除、未删除、失败目标、实际释放空间，以及首次构建需要重建缓存的预期影响。

## 验证记录

- `npm run check`：通过；OpenSpec 主规格 10 项、Vitest 111 项和 Rust 68 项测试通过，前端构建及产物检查通过。
- `git diff --check`：主工作区与变更工作树均通过。
- `openspec validate cleanup-generated-artifacts --strict`：通过。
- `codegraph sync`：成功，最终状态已是最新。
- 清理结果：白名单目标全部删除，按删除前分配大小约释放 7.39 GiB；当前 2.0.2 发布产物和原有未提交工作区修改保持不变。
