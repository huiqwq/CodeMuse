# Changelog

CodeMuse 的重要版本变化记录在此文件中。每个正式版本还必须在 `docs/releases/` 下提供独立说明文档，记录目标、功能、限制、测试和使用方法。

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
