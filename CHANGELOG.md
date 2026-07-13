# Changelog

CodeMuse 的重要版本变化记录在此文件中。每个正式版本还必须在 `docs/releases/` 下提供独立说明文档，记录目标、功能、限制、测试和使用方法。

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
