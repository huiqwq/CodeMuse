# CodeMuse 架构

## v0.8.0 执行链路

```text
CLI 自然语言任务
  -> SessionRecorder 创建任务记录
  -> ProjectScanner + TaskPlanner + ContextSelector
  -> ModelAgent
  -> ToolRegistry
       ├─ list_files / read_file / search_code
       ├─ apply_patch
       ├─ create_file / rename_file / delete_file
       │    -> 路径和文本安全检查
       │    -> Diff 或操作清单
       │    -> 用户逐项授权
       │    -> ChangeJournal
       ├─ git_status / git_diff
       │    -> 首次写入前的只读状态基线
       │    -> 固定 Git 参数、超时和输出上限
       │    -> 用户已有 / Agent / 共同修改分类
       └─ list_scripts -> run_script -> 授权 -> ProcessRunner
                                      -> stdout / stderr / exitCode
  -> FailureDiagnostics + RepairPolicy
  -> Agent 文件操作总结
  -> AgentEvent 安全摘要
  -> WorkspaceCheckpoint
  -> SessionStore -> .codemuse/sessions/<UUID>.json
                  -> /history
                  -> /resume [ID]
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
│  ├─ atomic-write.ts
│  ├─ change-journal.ts
│  └─ diff.ts
├─ context/
├─ models/
├─ sessions/
├─ tools/
│  ├─ filesystem/
│  │  ├─ create-file.ts
│  │  ├─ delete-file.ts
│  │  ├─ rename-file.ts
│  │  └─ text-file-safety.ts
│  ├─ git/
│  │  ├─ git-diff.ts
│  │  ├─ git-status.ts
│  │  └─ process-runner.ts
│  ├─ patch/
│  ├─ scripts/
│  ├─ search/
│  └─ registry.ts
├─ ui/
├─ commands/
└─ cli.ts
```

## 文件生命周期

### 路径解析

现有文件使用 `resolveWorkspacePath`：

- 只接受工作区相对路径。
- 拒绝 `..` 越界和绝对路径。
- 拒绝 `.git`、`.codemuse`、依赖、构建目录和敏感文件。
- 通过 realpath 确认符号链接目标仍在工作区。

新文件使用 `resolveWorkspaceDestination`：

- 目标必须不存在。
- 父目录必须已经存在并且 realpath 位于工作区。
- 不自动创建目录。
- 确认完成后再次解析，防止确认期间被其他进程占用。

### 文本安全

`create_file` 最多接收 100 KB 的有效 Unicode 文本。读取、删除和重命名最多处理 1 MB 的普通 UTF-8 文本文件。二进制扩展名、NUL 内容、符号链接删除和符号链接重命名均被拒绝。

`rename_file` 和 `delete_file` 要求模型先在当前任务中调用 `read_file`。所有写操作默认拒绝，用户只有输入 `y` 或 `yes` 才能授权。

### ChangeJournal

ChangeJournal 按发生顺序记录四种操作：

- `modify`：原内容、新内容和模式。
- `create`：新路径、内容和模式。
- `delete`：旧路径、内容和模式。
- `rename`：原路径、目标路径、内容和模式。

单任务最多涉及 20 个文件和 40 次操作。每次操作完成后记录，任务结束时成为当前进程可撤销的最近任务。

`/undo` 先校验所有路径仍处于 Agent 完成后的状态，再展示逆向 Diff 和操作清单。用户批准后按相反顺序撤销，因此可处理“重命名 -> 修改 -> 删除”等混合操作。任一步失败时只尝试回滚已经撤销的步骤，不覆盖检测到的外部变化。

## Git 审查

### Git 状态基线

ToolRegistry 在当前任务首次写入前调用一次只读 `git status --porcelain`，保存任务基线。后续 `git_status` 重新读取当前状态，并按路径分类：

- `user-existing`：任务开始前已经存在，Agent 未涉及。
- `agent`：本次 Agent 新产生。
- `user-and-agent`：任务前已有修改，且 Agent 又修改了同一路径。
- `user`：基线后出现但不属于 Agent 记录。

状态同时返回当前分支。忽略和敏感路径在交给模型前过滤。

### Git Diff

`git_diff` 仅执行固定只读参数：

- 默认读取未暂存 Diff。
- `staged: true` 读取已暂存 Diff。
- 可传入一个经过工作区安全检查的相对文件路径。
- 未指定路径时使用排除 pathspec 过滤敏感、会话、依赖和构建路径。

Git 子进程使用 `shell:false`、10 秒超时、80 KB 合并输出上限，并清理 API Key、Token、Secret、Password 和 Private Key 环境变量。没有注册任何 Git 写工具，Agent 无法执行 add、commit、checkout、reset 或 push。

## 会话记录

CLI 为每条自然语言任务创建 SessionRecorder，只保存：

- 工具名称和成功/失败摘要。
- 授权类型、路径和批准/拒绝结果。
- notice、error、complete 和最终文件操作摘要。
- 项目扫描、计划、上下文和工作区检查点。

不保存 ApprovalRequest Diff、完整命令输出、模型逐字回答、原始 Tool Call 参数和明文 API Key。任务结束后保存到 `.codemuse/sessions/`，最多 50 条。

恢复流程：

```text
/history
  -> 显示最近 10 条

/resume [prefix]
  -> 校验 UUID 和 schema
  -> 重算 WorkspaceCheckpoint
  -> 不一致或扫描截断：拒绝
  -> 一致：恢复 AgentSessionState
  -> 下一任务重新扫描
  -> 有限历史摘要作为不可信背景
```

恢复不会重放旧写入、脚本或授权。ChangeJournal 仍只保存在当前 CodeMuse 进程中。

## 自动修复

FailureDiagnostics 负责错误分类、源码位置和失败指纹。RepairPolicy 负责：

- 相同失败第二次出现时停止。
- 单任务最多三个修复补丁。
- 最大 20 个模型轮次。
- 停止后不再向模型提供工具。

自动修复不会绕过文件操作或脚本执行授权。

## 安全边界

- 完整项目保留在用户本地，只发送任务相关上下文。
- 文件工具只处理工作区内允许的普通文本路径。
- 每次写入、重命名、删除、撤销和脚本执行都要求明确授权。
- 只允许 package.json 中 test/build/lint/typecheck/check 类 npm scripts。
- 不执行任意 Shell、不自动 npm install。
- Git 能力只读，不自动 commit 或 push。
- `.codemuse` 不进入项目扫描、模型上下文或 Git Diff。
- API Key 不进入工具子进程和会话。
- 恢复文本和项目代码都视为不可信内容，不能覆盖系统提示。

## 后续架构扩展

- v0.9.0：Provider 配置、连接测试、模型切换、重试与 Token 统计。
- v0.10.0：npm 发布入口、首次配置、诊断和跨平台适配。
- v0.11.0：端到端安全、兼容性和性能验收。
- v1.0.0：稳定连接分析、修改、验证、修复、Git 审查与会话恢复。

完整产品范围见 [README](../README.md) 与 [project-guide.md](project-guide.md)。
