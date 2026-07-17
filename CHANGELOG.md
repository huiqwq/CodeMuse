# Changelog

CodeMuse 的重要版本变化记录在此文件中。每个正式版本还必须在 `docs/releases/` 下提供独立说明文档，记录目标、功能、限制、测试和使用方法。

## [1.0.0] - 2026-07-17

详细说明：[docs/releases/v1.0.0.md](docs/releases/v1.0.0.md)

### Added

- npm 公开发布配置、文件白名单和 `prepack` 质量门。
- 首次启动提示、`/doctor`、`/doctor export` 和脱敏诊断事件。
- macOS Keychain 与 Linux Secret Service 安全凭据后端。
- CLI、隐私、迁移和故障排查文档。

### Changed

- 项目版本升级为 `1.0.0`，CLI 标题和路线图同步更新。
- 自动测试增加到 77 项。

### Security

- 无安全凭据后端时不回退明文存储。
- 诊断不保存源码、完整 Diff、模型原文或密钥。

## [0.14.0] - 2026-07-17

详细说明：[docs/releases/v0.14.0.md](docs/releases/v0.14.0.md)

- 上下文选择增加 import、反向关联和测试关系加权。
- 补丁写入前校验 `read_file` SHA-256 指纹。
- ToolRegistry 强制执行批准计划的写入范围。
- `apply_patch_set` 一次预览并原子应用多文件协调变更。
- 增加 `/approval strict|plan-scoped` 和验证完成证据。

## [0.13.0] - 2026-07-17

详细说明：[docs/releases/v0.13.0.md](docs/releases/v0.13.0.md)

- 增加工作区项目记忆、来源、关联路径和文件指纹失效。
- 增加 `/memory list/show/add/forget/clear`。
- 记忆检索使用独立 Token 预算并拒绝敏感凭据。

## [0.12.0] - 2026-07-17

详细说明：[docs/releases/v0.12.0.md](docs/releases/v0.12.0.md)

- 增加可恢复 Goal、成功标准、子任务、预算、证据和阻塞状态。
- 增加 `/goal create/status/pause/resume/complete/cancel/history`。

## [0.11.0] - 2026-07-17

详细说明：[docs/releases/v0.11.0.md](docs/releases/v0.11.0.md)

- 增加持续 Plan Mode 和 `/plan on/status/revise/approve/off`。
- 增加结构化 PlanArtifact、修订记录、范围与工作区过期检测。
- 规划期间仅允许只读工具；未批准计划不能进入执行。

## [0.10.0] - 2026-07-15

详细说明：[docs/releases/v0.10.0.md](docs/releases/v0.10.0.md)

### Added

- `codemuse auth login/status/logout` 安全凭据命令。
- Windows DPAPI 当前用户加密凭据存储。
- `/review [PATH]` 只读代码审查。
- `/review --fix [PATH]` 确认后修复与验证。
- `/paste` 多行代码片段审查。
- 凭据、命令、工具策略和片段隔离自动测试。

### Changed

- 项目版本升级为 `0.10.0`。
- 模型配置按环境变量、持久凭据的顺序解析。
- ToolRegistry 支持 full、read-only 和 none 任务权限策略。
- Mock 模式更新为安全凭据与代码审查边界演示。
- 自动测试由 63 项增加到 71 项。

### Security

- 凭据文件只保存 DPAPI 密文，不保存明文 API Key。
- API Key 不进入 DPAPI 子进程参数、环境变量、日志或 Git。
- 只读审查在工具展示和执行入口双重拒绝写入与执行。
- 粘贴审查不扫描本地项目、不附加本地代码、不给模型工具。
- 粘贴完整内容不进入会话历史。
## [0.9.0] - 2026-07-15

详细说明：[docs/releases/v0.9.0.md](docs/releases/v0.9.0.md)

### Added

- DeepSeek、GLM、OpenAI 和自定义兼容 Provider Profile。
- `~/.codemuse/config.json` 本机配置模板、schema 校验和最多 20 个 Profile。
- `/model list`、`/model use`、`/model test`、`/model init`、`/model reload`。
- `/usage` 当前进程、按模型 Token 用量汇总。
- ManagedAgent 动态代理和切换时 AgentSessionState 保留。
- API 最小连接测试、请求延迟、尝试次数和 Token 结果。
- 网络错误、429、500、502、503、504 有限重试和 Retry-After。
- 流式 OpenAI-compatible usage 解析和 model-usage 事件。
- 配置、切换、连接、重试、鉴权快速失败、脱敏和 Token 自动测试。

### Changed

- 项目版本升级为 `0.9.0`。
- CLI 启动改为异步加载本机模型配置。
- CompatibleProvider 增加 30 秒默认超时和 2 次默认重试。
- Mock 模式更新为多模型与 API 管理演示。
- SessionRecorder 保存有限 Token 数量摘要。
- OpenAI 成为内置 Provider 预设。
- GLM 默认模型更新为已验收的 glm-5.2，并增加 glm-flash（glm-4.7-flash）备用 Profile。
- 旧 `CODEMUSE_PROVIDER/CODEMUSE_API_KEY` 方式继续兼容。
- 自动测试由 51 项增加到 63 项。

### Security

- Profile JSON 只保存 `apiKeyEnv`，拒绝 `apiKey` 和其他未知字段。
- API Key 不进入 Profile 列表、错误详情、项目文件或会话。
- 错误正文中的当前 Key 替换为 `[REDACTED]`。
- 401/403 等鉴权错误不重试。
- 只在流式正文开始前重试，避免重复 Tool Call。
- 连接测试明确使用最多生成 1 Token 的最小请求。
## [0.8.0] - 2026-07-15

详细说明：[docs/releases/v0.8.0.md](docs/releases/v0.8.0.md)

### Added

- `create_file` 安全创建最多 100 KB 的 UTF-8 文本文件。
- `rename_file` 和 `delete_file` 已读取文本文件操作。
- 每次创建、重命名和删除前的独立授权与冲突复检。
- ChangeJournal 的 create、modify、rename、delete 操作记录和混合撤销。
- `git_status` 当前分支、Porcelain 状态和变更归属。
- `git_diff` 未暂存/已暂存只读 Diff 和可选路径过滤。
- 首次写入前的 Git 状态基线与 Agent 变更路径总结。
- Git 固定参数子进程、10 秒超时、80 KB 输出上限和敏感环境变量清理。
- 文件生命周期、Git 解析、归属、非仓库、超时和截断测试。

### Changed

- 项目版本升级为 `0.8.0`。
- ModelAgent 注册工具由 6 个增加到 11 个，并更新文件与 Git 安全提示。
- 每个成功模型任务输出确定性的 Agent 文件操作摘要。
- Mock 模式说明 v0.8 文件操作和 Git 审查边界。
- `/undo` 从只支持内容修改升级为支持混合文件生命周期操作。
- 自动测试由 43 项增加到 51 项。

### Security

- 新文件目标必须不存在，父目录必须在工作区内且已经存在。
- 创建、重命名和删除只处理允许的普通 UTF-8 文本路径。
- 重命名和删除要求当前任务先读取文件，并拒绝符号链接。
- 所有高风险文件操作在授权后再次检查内容和目标占用。
- Git Status 过滤敏感和忽略路径，Git Diff 使用排除 pathspec。
- Git 子进程使用 `shell:false`，没有注册任何 Git 写操作。
- 不自动执行 add、commit、checkout、reset、push 或 npm install。

## [0.7.0] - 2026-07-15

详细说明：[docs/releases/v0.7.0.md](docs/releases/v0.7.0.md)

### Added

- 工作区本地 `.codemuse/sessions/` 会话存储。
- `/history` 最近 10 条会话列表。
- `/resume [ID]` 最新或 ID 前缀恢复。
- 任务、计划、上下文、工具摘要、授权结果和状态记录。
- 工作区文件清单、大小和修改时间 SHA-256 检查点。
- 恢复摘要注入下一次 ModelAgent 任务。
- 会话 schema、大小、数量和恢复上下文限制。
- 会话存储、变化拒绝、脱敏和模型恢复集成测试。

### Changed

- 项目版本升级为 `0.7.0`。
- AgentRunner 增加安全状态恢复接口和可选恢复上下文。
- Mock 模式展示会话恢复信息。
- CLI 在每条自然语言任务结束后保存会话。
- 自动测试由 38 项增加到 43 项。

### Security

- 不保存明文 API Key、完整 Diff、完整命令输出或模型流式回答。
- 对显式 API Key、Bearer Token 和 `sk-` Key 形式脱敏。
- `.codemuse` 始终从扫描和模型上下文中排除。
- 会话目录 realpath 必须位于当前工作区。
- 工作区发生变化或扫描被截断时拒绝恢复。
- 恢复历史按不可信数据处理，不能覆盖系统提示。
- 不自动重放旧写入、脚本、Git 操作或授权。

## [0.6.0] - 2026-07-15

详细说明：[docs/releases/v0.6.0.md](docs/releases/v0.6.0.md)

### Added

- `FailureDiagnostics` 对验证失败进行分类、摘要和源码位置提取。
- 稳定失败指纹，忽略行列号、工作区绝对路径和耗时变化。
- `RepairPolicy` 管理修复补丁次数、复测状态和停止原因。
- “失败→读取相关代码→补丁→重新验证”Agent Loop。
- 停止后不再向模型提供工具，只允许总结证据。
- 自动修复成功、失败诊断、补丁次数和停止提示。
- 完整 v0.6.0 自动修复集成测试。
- v0.7.0 至 v1.0.0 完整产品路线。

### Changed

- 项目版本升级为 `0.6.0`。
- ModelAgent 最大轮数由 12 调整为 20，并受独立修复策略限制。
- Mock 模式明确不执行脚本、不修改文件和不伪造验证结果。
- README 增加最终产品功能、API 接入和逐版本交付计划。
- 自动测试由 34 项增加到 38 项。

### Security

- 相同失败第二次出现时自动停止无效循环。
- 单任务最多允许三个已应用修复补丁。
- 所有自动修复写入和复测继续要求用户确认。
- 诊断只保留有限输出并过滤工作区外和构建目录位置。
- 当前仍不执行任意 Shell、npm install、Git 写操作或文件删除。

## [0.5.0] - 2026-07-13

详细说明：[docs/releases/v0.5.0.md](docs/releases/v0.5.0.md)

### Added

- `list_scripts` 安全读取根目录 `package.json` scripts。
- `run_script` 受控执行 test/build/lint/typecheck/check 类 npm scripts。
- 执行前脚本内容展示和 `execute` 风险授权。
- 超时、输出上限、退出码、stdout/stderr 和命令输出事件。
- 取消或超时时的跨平台进程树终止。
- 模型 API Key、Token、Secret 和 Password 环境变量清理。
- Windows `node.exe + npm-cli.js` 无 Shell 调用。
- `package.json` 开发目录与目标项目边界说明。
- 脚本发现、拒绝、执行、失败、超时和 Agent 集成测试。

### Changed

- 项目版本升级为 `0.5.0`。
- ModelAgent 可在用户授权后运行允许的项目验证脚本。
- Mock 模式说明脚本能力，但不会执行项目命令。
- 自动测试由 26 项增加到 34 项。

### Security

- 不接受任意 Shell 字符串或额外参数。
- 脚本必须来自当前任务的 `list_scripts`。
- 禁止 dev/start/install/prepare/deploy/publish 和 pre/post 脚本。
- 设置 `--ignore-scripts` 和 `npm_config_ignore_scripts=true`。
- 每次执行必须获得明确授权。
- 当前仍不执行 npm install、Git 写操作或 Monorepo 子包脚本。

## [0.4.0] - 2026-07-13

详细说明：[docs/releases/v0.4.0.md](docs/releases/v0.4.0.md)

### Added

- `apply_patch` 精确局部替换工具。
- Unified Diff 生成与终端授权交互。
- 同目录临时文件安全替换。
- 当前进程内任务变更日志和 `/undo`。
- 修改前读取约束、唯一匹配、整文件覆盖和并发变化保护。
- 模型输出与 Diff 的终端控制字符转义。
- 写入拒绝、确认写入、CRLF、撤销和完整 Agent 修改链路测试。

### Changed

- 项目版本升级为 `0.4.0`。
- ModelAgent 从只读分析升级为可请求受控局部写入。
- 任务计划和 CLI 文案覆盖分析与修改任务。
- 自动测试由 18 项增加到 26 项。
- Mock 模式说明安全修改边界，但不会伪装生成补丁。

### Security

- 没有明确授权时所有写入默认拒绝。
- 模型必须在当前任务中先使用 `read_file` 读取目标。
- `oldText` 必须唯一匹配，禁止整文件覆盖。
- 写入与撤销在确认后再次校验文件内容。
- 单任务最多记录 20 个修改文件。
- 当前仍不提供文件创建、删除、Shell 或 Git 写操作。

## [0.3.0] - 2026-07-13

详细说明：[docs/releases/v0.3.0.md](docs/releases/v0.3.0.md)

### Added

- 项目扫描器，识别项目名称、类型、语言、框架、包管理器和关键文件。
- 四步任务计划及 Agent 内部进度状态。
- 基于任务关键词、路径和文件内容的上下文相关性排序。
- 可配置的上下文 Token 预算、单文件截断和候选文件省略统计。
- `/plan`、`/context`、`/scan` 终端命令。
- 项目扫描、上下文筛选、Token 预算和完整 Mock 流程测试。

### Changed

- 项目版本升级为 `0.3.0`。
- Mock 模式升级为真实执行项目扫描、上下文选择和 Token 控制。
- ModelAgent 在首轮模型请求前提供项目概览和精选代码片段。
- `/clear` 同时清空终端显示和当前任务状态。
- 任务运行期间拒绝清空状态，`/exit` 后不再输出已排队的步骤事件。
- 自动测试由 12 项增加到 18 项。
- 团队协作说明改为当前采用的直接提交 `main` 流程。

### Security

- 初始模型上下文只包含当前任务筛选出的安全文本片段。
- 继续忽略敏感配置、依赖目录、构建目录、二进制和超大文件。
- 系统提示明确将项目代码视为不可信数据，防止代码中的指令覆盖 Agent 规则。
- 当前版本仍无写文件、Shell 或 Git 写权限。

## [0.2.0] - 2026-07-13

详细说明：[docs/releases/v0.2.0.md](docs/releases/v0.2.0.md)

### Added

- 工作区真实路径校验与路径越界防护。
- 默认忽略 `.git`、`node_modules`、构建目录和敏感配置。
- `list_files`、`read_file`、`search_code` 三个只读工具。
- 工具注册中心、参数校验、结果截断和错误回传。
- OpenAI-compatible 流式 Tool Calling 解析。
- `LLM -> Tool Call -> Tool Result -> LLM` Agent Loop。
- CLI 工具开始、成功和失败事件展示。
- Mock 模式真实执行本地只读工具。
- 路径安全、文件读取、代码搜索和 Agent Loop 测试。
- TypeScript 静态类型检查和锁定的开发依赖。
- `npm link` 全局命令注册与跨项目启动说明。

### Changed

- 项目版本升级为 `0.2.0`。
- ModelAgent 从单次模型问答升级为最多 12 轮的只读 Agent Loop。
- ModelProvider 支持文本增量和工具调用增量。

### Security

- 工具只接受工作区相对路径。
- 通过 `realpath` 阻止符号链接访问工作区外部。
- 拒绝二进制、超大、敏感和被忽略文件。
- 当前版本不提供写文件和 Shell 工具。

## [0.1.0] - 2026-07-13

详细说明：[docs/releases/v0.1.0.md](docs/releases/v0.1.0.md)

### Added

- CodeMuse 交互式 CLI 基线。
- AgentRunner、AgentEvent、MockAgent 和 ModelAgent。
- DeepSeek、GLM 和自定义兼容模型配置。
- 流式终端输出、任务取消和斜杠命令。
- 初始测试、README、架构与协作文档。
