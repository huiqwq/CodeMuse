# 故障排查

- 模型不可用：运行 `/model list`、`/model test <NAME>` 和 `/doctor`。
- 计划变成 `stale`：工作区已经变化，使用 `/plan revise <要求>` 重新探索。
- Goal 进入 `blocked`：检查 `/goal status` 的预算和最近失败，解决外部问题后创建新 Goal。
- 记忆显示 `stale`：关联文件已变化；遗忘旧记录并在重新验证后添加新记忆。
- Linux 凭据失败：确认 `secret-tool` 已安装且 Secret Service/DBus 会话可用。
- macOS 凭据失败：确认当前用户 Keychain 已解锁。
- Windows 凭据失败：确认在普通当前用户 PowerShell/终端中运行。
- 需要诊断：执行 `/doctor export`，检查 `.codemuse/diagnostics.json`；文件不含源码和模型原始响应。
