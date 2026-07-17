# CodeMuse 架构

## v1.0.0 执行链路

```text
CLI 启动
  -> CredentialStore 读取 DPAPI / Keychain / Secret Service
  -> ProfileStore 合并环境变量和持久凭据
  -> PlanStore / GoalStore / ProjectMemoryStore / SettingsStore
  -> ManagedAgent 选择 Mock 或 ModelAgent
  -> /model 可在任务之间切换 Provider
  -> /review、/review --fix 和 /paste 选择任务权限
CLI 自然语言任务
  -> Plan Mode：只读探索 -> 结构化计划 -> 指纹校验 -> 批准
  -> Goal Mode：目标/预算/证据 -> 当前前台子任务
  -> Memory：检索未失效项目记忆（独立 Token 预算）
  -> SessionRecorder 创建任务记录
  -> ProjectScanner + TaskPlanner + ContextSelector
  -> ModelAgent
  -> CompatibleProvider
       ├─ 30 秒默认超时
       ├─ 网络错误 / 429 / 指定 5xx 有限重试
       ├─ 流式文本与 Tool Call
       └─ Token usage
  -> ToolRegistry
       ├─ list_files / read_file / search_code
       ├─ apply_patch / apply_patch_set
       │    -> 校验 read_file SHA-256 指纹
       │    -> 多文件变更一次预览、失败回滚
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
  -> executionScope 拒绝计划范围外写入
  -> Completion evidence 标记 verified / unverified
  -> FailureDiagnostics + RepairPolicy
  -> Agent 文件操作总结
  -> AgentEvent 安全摘要
  -> WorkspaceCheckpoint
  -> SessionStore -> .codemuse/sessions/<UUID>.json
                  -> /history
                  -> /resume [ID]
```

工作区新增数据文件：

```text
.codemuse/
├─ plan.json
├─ goals.json
├─ memory.json
├─ settings.json
├─ diagnostics.json
└─ sessions/
```

这些文件均从扫描、模型代码上下文和 Git Diff 中排除。

## 当前模块

```text
src/
├─ agent/
│  ├─ agent-state.ts
│  ├─ failure-diagnostics.ts
│  ├─ managed-agent.ts
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
│  ├─ compatible-provider.ts
│  ├─ config.ts
│  └─ profile-store.ts
├─ credentials/
├─ review/
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

## 多模型管理

### ProfileStore

本机配置默认位于 `~/.codemuse/config.json`，也可以用 `CODEMUSE_CONFIG_PATH` 覆盖。文件限制为 128 KB、普通 JSON 文件和 `schemaVersion: 1`，最多 20 个 Profile。

每个 Profile 包含：

```text
name
provider
baseUrl
model
apiKeyEnv
timeoutMs（可选）
maxRetries（可选）
```

不允许明文 apiKey 或其他未知字段。ProfileStore 先读取当前进程环境变量，再读取 CredentialStore 中同名 apiKeyEnv 的解密值。内置 deepseek、glm、glm-flash、openai 四个模板，其中两个 GLM Profile 共用 ZHIPUAI_API_KEY；旧 CODEMUSE_API_KEY 继续映射为 environment Profile。

### CredentialStore

CredentialStore 默认位于用户目录的 .codemuse/credentials.json。Windows 后端使用 DPAPI CurrentUser 加密，文件只保存 schema、后端名称和密文。环境变量优先于持久凭据；未支持平台不降级保存明文。auth 命令按 Profile 的 apiKeyEnv 保存，因此两个 GLM Profile 共享同一凭据。

凭据子进程使用固定 PowerShell 参数、标准输入和有限环境变量，不把 Key 放入参数、日志、会话或普通工具子进程。

### ReviewPolicy

review 报告使用 read-only 工具集合，Registry.definitions 和 Registry.execute 双重检查风险。review --fix 使用 full 策略并沿用已有授权；paste 使用 none 策略和空工作区上下文，防止把用户粘贴片段与本地项目混合。

### ManagedAgent

ManagedAgent 包装 MockAgent/ModelAgent，并持有共享 ToolRegistry：

- `/model use` 只在没有任务运行时调用。
- 切换前保存 AgentSessionState，创建新 delegate 后恢复。
- ToolRegistry 不重建，因此最近任务 `/undo` 仍然有效。
- `/model reload` 重新校验配置文件和当前进程环境变量。
- `/model test` 使用独立 Provider 发送最小非流式请求。
- 所有已解析 Key 只用于 Provider 和 SessionRecorder 脱敏列表。

### CompatibleProvider

每个请求使用 Profile 的 `timeoutMs` 和 `maxRetries`。默认超时 30000ms，最多重试 2 次：

- 重试：网络失败、429、500、502、503、504。
- 不重试：400、401、403 和其他确定性请求错误。
- 尊重 `Retry-After`，等待最多 5 秒。
- 只重试尚未返回流式正文的请求，避免重复处理 Tool Call。
- 错误正文最多保留 300 字符，并替换当前 API Key。

流式请求开启兼容 usage 返回。ModelAgent 把 usage 转换为 `model-usage` 事件，ManagedAgent 按模型累计，CLI 实时显示并由 `/usage` 汇总。

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
- notice、Token usage、error、complete 和最终文件操作摘要。
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
- 默认 `strict` 下每次写入和执行要求明确授权；显式 `plan-scoped` 只自动授权批准范围内普通写入和验证，删除、重命名与范围外操作仍需确认。
- 只允许 package.json 中 test/build/lint/typecheck/check 类 npm scripts。
- 不执行任意 Shell、不自动 npm install。
- Git 能力只读，不自动 commit 或 push。
- `.codemuse` 不进入项目扫描、模型上下文或 Git Diff。
- API Key 不进入普通工具子进程、Profile JSON、终端列表和会话。
- CredentialStore 在 Windows 使用 DPAPI、macOS 使用 Keychain、Linux 使用 Secret Service；环境变量仍可覆盖。
- 本机 Profile 只保存凭据标识，不保存明文 Key。
- paste 任务不扫描项目、不发送本地上下文、不提供工具。
- 连接测试最多请求生成 1 Token，但仍是真实 API 调用。
- Token 用量来自供应商 usage，只用于本地显示和有限会话摘要。
- 恢复文本和项目代码都视为不可信内容，不能覆盖系统提示。

## v1 后续兼容原则

- 保持主要命令、配置字段和工作区数据 schema 向前兼容。
- 新的高风险能力默认关闭，并由工具执行入口实施约束。
- 数据迁移失败时拒绝覆盖原文件，提示用户诊断和恢复。

完整产品范围见 [README](../README.md) 与 [project-guide.md](project-guide.md)。
