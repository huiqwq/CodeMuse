# 隐私与本地数据

CodeMuse 在工作区 `.codemuse/` 中保存会话、计划、Goal、项目记忆、设置和有限诊断事件。该目录不会进入项目扫描、模型代码上下文或 Git Diff。

- 会话不保存完整模型回答、完整命令输出、完整 Diff 或明文 API Key。
- 项目记忆拒绝疑似 API Key、Bearer Token 和 `sk-` 凭据。
- 诊断只保存时间、级别、类别和最多 500 字的脱敏摘要。
- Windows 凭据由 DPAPI CurrentUser 保护；macOS 使用 Keychain；Linux 使用 Secret Service。
- 不支持安全后端的平台只允许环境变量，不回退到明文凭据文件。

用户可以删除 `.codemuse/` 清除当前项目数据，或使用 `/memory clear` 单独清除长期记忆。
