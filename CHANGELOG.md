# Changelog

CodeMuse 的重要版本变化记录在此文件中。每个正式版本还必须在 `docs/releases/` 下提供独立说明文档，记录目标、功能、限制、测试和使用方法。

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
