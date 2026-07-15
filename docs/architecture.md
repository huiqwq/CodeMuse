# CodeMuse 架构

## v0.7.0 执行链路

```text
CLI 自然语言任务
  -> SessionRecorder 创建任务记录
  -> ProjectScanner + TaskPlanner + ContextSelector
  -> ModelAgent
  -> ToolRegistry
       ├─ list_files / read_file / search_code
       ├─ apply_patch -> Diff -> 授权 -> AtomicWrite -> ChangeJournal
       └─ list_scripts -> run_script -> 授权 -> ProcessRunner
                                      -> stdout / stderr / exitCode
  -> FailureDiagnostics + RepairPolicy
  -> AgentEvent 安全摘要
  -> WorkspaceCheckpoint
       -> 文件清单 / 大小 / 修改时间
       -> SHA-256
  -> SessionStore
       -> .codemuse/sessions/<UUID>.json
       -> 最多 50 条
       -> /history
       -> /resume [ID]
            -> 校验工作区检查点
            -> AgentStateStore.restore
            -> 下一任务加入有限历史摘要
```

## 当前模块

```text
src/
├─ agent/
│  ├─ agent-state.ts
│  ├─ failure-diagnostics.ts
│  ├─ model-agent.ts
│  ├─ mock-agent.ts
│  ├─ repair-policy.ts
│  └─ task-planner.ts
├─ changes/
├─ context/
├─ models/
├─ sessions/
│  ├─ checkpoint.ts
│  ├─ session-recorder.ts
│  ├─ session-store.ts
│  └─ types.ts
├─ tools/
├─ ui/
├─ commands/
└─ cli.ts
```

## 会话记录职责

### SessionRecorder

CLI 为每条自然语言任务创建一个 Recorder。它只从 AgentEvent 和用户授权中提取有限摘要：

- tool-complete：工具名称和结果摘要。
- tool-failed：工具名称和失败摘要。
- approval：风险类型、路径、批准或拒绝。
- notice、error、complete：任务状态和最终摘要。

以下内容明确不记录：

- ApprovalRequest.diff。
- command-output 完整内容。
- message-delta 模型逐字回答。
- Tool Call 原始参数。
- 明文 API Key。

Recorder 对显式 `CODEMUSE_API_KEY`、Bearer Token、`sk-` 形式以及当前进程 API Key 做脱敏。

### WorkspaceCheckpoint

任务结束时重新扫描工作区，并对以下数据计算 SHA-256：

```text
扫描是否截断
文件相对路径
文件大小
文件修改时间
```

`.codemuse/`、`.git/`、`node_modules/`、构建目录、敏感文件和符号链接不进入扫描。

检查点不是源代码内容备份，只用于判断旧上下文是否明显过期。扫描超过 2500 个文件时标记 truncated，该会话可以查看，但不能恢复。

### SessionStore

- 延迟创建 `.codemuse/sessions/`。
- 使用 realpath 确保会话目录仍在工作区内。
- UUID 文件名和 `schemaVersion: 1`。
- 单条会话最多 512 KB。
- 最多保留 50 条，按修改时间清理。
- 读取时验证任务、状态、项目、计划、上下文和活动结构。
- 项目文件列表在会话中最多保留 500 项。
- 恢复摘要最多携带最近 10 条、每条 400 字符活动。

### 恢复流程

```text
/history
  -> listRecords
  -> 显示最近 10 条

/resume [prefix]
  -> 查找唯一 UUID 前缀
  -> 读取并验证 schema
  -> 重算 WorkspaceCheckpoint
  -> 不一致：拒绝
  -> 一致：恢复 AgentSessionState
  -> 生成 AgentResumeContext
  -> 下一条自然语言任务重新扫描项目
  -> 历史摘要作为不可信背景加入用户消息
```

恢复不会重新执行旧补丁、旧脚本或旧授权。`/undo` 的 ChangeJournal 仍只存在于当前进程。

## 现有自动修复

`FailureDiagnostics` 负责错误分类、关键行、源码位置和失败指纹。`RepairPolicy` 负责补丁次数、复测和停止：

- 相同失败第二次出现时停止。
- 单任务最多三个修复补丁。
- 最大 20 个模型轮次。
- 停止后不再向模型提供工具。

会话只记录这些过程的摘要，不改变 v0.6.0 的修复安全规则。

## 安全边界

### 文件

- 只能访问工作区内允许的相对路径。
- realpath 防止符号链接越界。
- 拒绝敏感目录、二进制和超大文件。
- `apply_patch` 只能修改当前任务已读取的现有 UTF-8 文件。
- 写入前显示 Diff，默认拒绝。
- 当前不能创建、删除或重命名文件。

### 脚本

- 只执行根目录 `package.json` 中允许名称的 npm scripts。
- 模型不能提供任意 Shell 字符串和额外参数。
- `shell:false`，超时、输出和进程树均受控制。
- 清除 API Key、Token、Secret、Password 和 Private Key。
- 每次执行必须获得用户确认。

### 会话

- 会话保存在目标项目本地，不上传到 CodeMuse 服务。
- `.codemuse` 不进入模型项目上下文。
- 不保存完整代码 Diff、命令输出或模型回答。
- 工作区变化时拒绝旧会话恢复。
- 恢复文本不能覆盖系统提示。
- 用户应在目标项目 `.gitignore` 中加入 `.codemuse/`。

### 模型 API

- 当前预设 DeepSeek 和 GLM，并允许自定义 OpenAI-compatible 服务。
- 只发送任务相关的精选上下文。
- API Key 不进入工具、脚本和会话。
- Provider 连接测试、重试和 Token 统计安排在 v0.9.0。

## 后续架构扩展

- v0.8.0：完整文件生命周期工具和只读 `tools/git/`。
- v0.9.0：Provider 配置、连接测试、重试与统计。
- v0.10.0：发布入口、诊断命令和跨平台适配。
- v0.11.0：端到端安全、兼容性和性能验收。
- v1.0.0：稳定连接分析、修改、验证、修复、Git 审查与会话恢复。

完整产品范围见 [README](../README.md) 与 [project-guide.md](project-guide.md)。
