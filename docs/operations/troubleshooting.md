# 故障排查

## 应用白屏

确认 Cargo 默认 feature 包含 `custom-protocol`，并运行：

```bash
npm run build
npm run verify:frontend-dist -- dist
```

不要保留生成型 `vite.config.js`。安装包必须通过 `scripts/build-macos-arm64.sh` 的临时前端目录构建。

## 无法连接模型

- `401/403`：检查 API Key 和模型权限。
- `404`：检查 `Base URL` 是否重复包含 `/chat/completions`，以及模型名是否存在。
- `429`：等待限流恢复或检查额度。
- “已阻止重定向”：将 Base URL 改为服务最终地址。
- 明文 HTTP 提示：仅在明确理解风险时确认准确 Origin。
- “兼容模式”：服务不支持首选流式参数，应用正在使用兼容路径。

从错误操作区打开关联日志，按请求 ID 查看阶段；需要联系服务方时导出脱敏诊断，不粘贴 API Key 或原始响应。

## 图片或原图问题

- 支持 PNG、JPEG、WebP，最大 20MB、32768px 单边和 8000 万像素。
- 历史显示“仅保留缩略图”时不能直接重新反推，需要重新选择原图。
- “原图无法解密”通常表示 Keychain 密钥缺失或文件损坏；保留历史结果并先导出诊断。
- 长图优先使用“适应宽度”，再通过拖动、触控板、方向键或右下角位置导航浏览；`1` 可切换原始像素 `1:1`，`0` 恢复适应窗口。
- 查看器工具暂时消失属于沉浸模式：移动指针、滚动或按任意查看器快捷键即可恢复；聚焦工具后不会自动隐藏。

## 构建问题

- 1420 端口占用：结束旧 Vite/Tauri 进程后重试。
- Cargo 缓存权限异常：设置可写的 `CARGO_TARGET_DIR`，不要使用管理员权限修改仓库。
- 仓库改名后 Tauri 报告旧绝对路径：运行 `cargo clean --manifest-path src-tauri/Cargo.toml` 清理生成缓存，再执行 `npm run check`。
- `resource fork`：执行 `xattr -cr artifacts/release/绘钥.app` 后重新签名和验证。
- `dist/` 不可写：`npm run check` 不依赖仓库 `dist/`；发布脚本也使用临时目录。
