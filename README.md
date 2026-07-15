# CodeMuse

CodeMuse 是一款本地终端智能编程助手。用户用自然语言提出任务，Agent 在用户选择的工作区中扫描项目、规划步骤、选择必要代码、调用模型、提出局部修改、执行受控验证，并根据真实错误继续修复。

项目代码保留在用户电脑上。CodeMuse 不要求把整个仓库上传到浏览器或自建服务器，只会把当前任务需要的代码片段发送给用户配置的模型服务。

当前版本：**v0.9.0 多模型与 API 管理**。

## v0.9.0 已实现能力

- 持续交互和流式输出的 TypeScript CLI。
- DeepSeek、GLM、OpenAI 和自定义 OpenAI-compatible 模型配置。
- API Key 缺失时自动进入本地 Mock 模式。
- 项目扫描、任务计划、相关上下文选择和 Token 预算。
- `list_files`、`read_file`、`search_code` 代码库分析工具。
- `apply_patch` 精确局部修改、Unified Diff 确认、安全写入和 `/undo`。
- `list_scripts` 读取项目根目录 `package.json`。
- `run_script` 受控执行 test、build、lint、typecheck 和 check 类 npm scripts。
- 从 stdout/stderr 提取错误类别、关键错误、源码路径和行列号。
- 为相同错误生成稳定失败指纹。
- 引导模型完成“失败→读取相关代码→补丁→重新验证”闭环。
- 相同失败第二次出现时自动停止，避免无效循环。
- 单任务最多应用三个修复补丁，达到上限后只允许模型总结。
- 每次写入和脚本执行仍然必须由用户明确确认。
- `.codemuse/sessions/` 本地会话存储和工作区检查点。
- `/history` 查看最近 10 条任务。
- `/resume [ID]` 恢复最新或指定历史会话。
- 恢复后旧计划、上下文和有限活动摘要进入下一条任务。
- 工作区变化或扫描截断时拒绝恢复过期上下文。
- 不保存明文 API Key、完整 Diff、命令完整输出和模型流式回答。
- 最多保留 50 条会话，旧记录自动清理。
- `create_file` 安全创建最多 100 KB 的 UTF-8 文本文件。
- `rename_file` 和 `delete_file` 只处理当前任务已读取的普通文本文件。
- 新建、重命名、删除均逐项展示 Diff 或路径清单并请求确认。
- 混合的新建、修改、重命名、删除可通过任务级 `/undo` 逆序恢复。
- `git_status` 只读返回当前分支和未提交变更。
- 首次写入前保存 Git 状态基线，区分任务前已有、Agent 和共同修改。
- `git_diff` 只读查看未暂存或已暂存 Diff，并过滤敏感和忽略路径。
- 每个模型任务结束时输出 Agent 文件操作摘要。
- 不提供任何 Git 写操作，不会自动 commit 或 push。
- DeepSeek、GLM、OpenAI 和自定义 OpenAI-compatible Provider Profile。
- `~/.codemuse/config.json` 本机配置模板，只保存 API Key 环境变量名。
- `/model list`、`/model use`、`/model test`、`/model init` 和 `/model reload`。
- 模型切换保留当前计划、上下文、会话恢复状态和最近修改撤销能力。
- 网络错误、HTTP 429 和 500/502/503/504 最多有限重试；401/403 不重试。
- 单次请求默认 30 秒超时，可按 Profile 配置 5 到 120 秒。
- 流式 API Token 统计、终端实时提示和 `/usage` 当前进程汇总。
- 连接测试使用 1 Token 上限的最小非流式请求并显示延迟、尝试次数和用量。
- API Key 不写入配置文件、项目、会话、错误详情或终端 Profile 列表。
- 兼容原有 `CODEMUSE_PROVIDER/CODEMUSE_API_KEY` 启动方式。
- 63 项自动测试及 TypeScript 静态检查。

当前版本不能执行任意 Shell 或 Git 写操作，不会自动安装依赖、commit 或 push。API Key 仍需在启动 CodeMuse 前通过环境变量提供；配置文件只保存对应环境变量名。Token 用量依赖模型服务返回 usage 字段；会话只在任务结束时保存，不支持崩溃后的中途恢复。

## 最终产品需要实现的功能

### 终端交互

- 在任意项目目录运行 `codemuse .`。
- 自然语言任务、流式回答、步骤状态、取消和错误展示。
- 查看工作区、模型、计划、上下文、历史记录和变更结果。
- Windows、macOS 和 Linux 一致使用。

### 模型与 API

- DeepSeek、GLM、OpenAI 及其他 OpenAI-compatible 服务。
- 每个服务独立配置 API Key、Base URL 和模型名称。
- API 连接测试、模型切换、超时、重试和限流反馈。
- Token 用量和上下文预算展示。
- API Key 只通过环境变量提供；本机配置只保存环境变量名，不写入项目和会话。

“OpenAI-compatible”指兼容调用协议，不代表只能使用 OpenAI。DeepSeek、GLM 或其他提供兼容接口的服务都可以通过同一适配层接入。

### 本地代码 Agent

- 扫描目录并识别语言、框架、包管理器和关键文件。
- 根据任务筛选代码片段，不发送整个项目。
- 制定计划并进行多轮“模型→工具→结果→模型”决策。
- 读取、搜索、创建、修改、重命名和删除文本文件。
- 所有路径限制在工作区内，拒绝敏感文件、二进制和路径越界。
- 写入前展示 Diff，并支持任务级撤销。

### 构建、测试与自动修复

- 发现项目提供的安全验证脚本。
- 经确认后执行测试、构建、Lint 和类型检查。
- 返回真实命令、退出码、stdout、stderr、超时和截断状态。
- 提取错误位置并搜索相关实现。
- 提出修复补丁，获批后重新验证。
- 相同失败、修复次数和模型轮数达到限制时停止。
- 最终明确区分“已经验证通过”和“尚未验证”。

### Git 与变更审查

- 只读查看 Git Status、Diff 和当前分支。
- 汇总本次 Agent 修改的文件和验证结果。
- 检查未跟踪文件、敏感内容和异常大 Diff。
- 最终提交仍由用户完成；默认不自动 commit、push 或发布。

### 会话与恢复

- 保存任务、计划、精选上下文、工具调用、用户授权和验证结果。
- 保存检查点，支持 `/history`、`/resume` 和任务恢复。
- 会话中不保存明文 API Key。
- 项目改变后检测旧会话是否已经失效。

### 安装、发布与安全

- 支持 npm 全局安装，不依赖开发者电脑上的源码绝对路径。
- 提供首次配置向导和模型连接检查。
- 提供操作审计、清晰错误信息和恢复建议。
- 建立端到端测试、提示注入测试和大项目性能测试。
- 发布稳定的版本说明、安装包或 npm CLI 包。

## 当前执行链路

```text
自然语言任务
  -> ProfileStore 读取本机配置和环境变量
  -> ManagedAgent 选择当前 Provider
  -> ProjectScanner 扫描项目
  -> TaskPlanner 生成计划
  -> ContextSelector 选择必要代码
  -> CompatibleProvider 执行超时、有限重试和 Token 采集
  -> 模型选择受控工具
  -> 读取 / 搜索 / 局部补丁
  -> 创建 / 重命名 / 删除文本文件（逐项授权）
  -> Git 状态基线 + 只读 Status / Diff
  -> list_scripts
  -> 用户确认 run_script
  -> 真实退出码和输出
  -> FailureDiagnostics 分类、定位和生成失败指纹
  -> 模型读取相关文件并提出补丁
  -> 用户确认 Diff
  -> 重新运行原脚本
  -> 成功，或由 RepairPolicy 按停止条件终止
  -> 输出 Agent 文件操作与 Git 变更归属摘要
  -> 输出 API Token 用量，可通过 /usage 汇总
  -> SessionRecorder 保存安全摘要
  -> WorkspaceCheckpoint 校验后允许 /resume
```

## package.json 什么时候必须有

这里要区分“开发 CodeMuse”和“使用 CodeMuse 分析其他项目”。

### 开发和测试 CodeMuse：必须有

`npm install`、`npm test`、`npm run typecheck` 和 `npm link` 都会在当前目录查找 `package.json`。必须先进入 CodeMuse 源码根目录：

```powershell
cd "C:\Users\Administrator\Documents\Codex\2026-07-13\u-an\CodeMuse"
Test-Path .\package.json
npm test
npm run typecheck
```

`Test-Path` 应返回 `True`。如果当前提示符仍然是：

```text
PS C:\Users\Administrator>
```

直接执行 `npm test` 会出现 `ENOENT`，因为该目录没有 CodeMuse 的 `package.json`。

也可以从任意位置指定 CodeMuse 目录：

```powershell
npm --prefix "C:\Users\Administrator\Documents\Codex\2026-07-13\u-an\CodeMuse" test
```

### 使用 CodeMuse 分析项目：不一定有

执行过一次 `npm link` 后：

```powershell
cd "D:\projects\my-app"
codemuse .
```

目标项目没有 `package.json` 时，仍然可以扫描、读取、搜索和局部修改代码；npm scripts、构建、测试及自动修复验证不可用。

需要验证功能时，目标项目根目录至少应包含：

```json
{
  "name": "my-app",
  "scripts": {
    "test": "node tests/run.js",
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  }
}
```

CodeMuse 不会自动创建 `package.json`，也不会自动执行 `npm install`。

## 安装与运行

其他成员首次使用：

```powershell
git clone https://github.com/huiqwq/CodeMuse.git
cd CodeMuse
npm install
npm test
npm run typecheck
npm link
```

每个人的源码绝对路径可以不同。完成 `npm link` 后，可以离开 CodeMuse 源码目录并分析其他项目：

```powershell
cd "D:\projects\其他项目"
codemuse .
```

Mock 模式会真实扫描和选择本地上下文，但不会修改文件、执行脚本或模拟测试成功：

```powershell
codemuse .
```

## 多模型与 API 配置

### 1. 创建本机配置模板

启动 CodeMuse 后执行：

```text
codemuse> /model init
```

默认创建：

```text
C:\Users\你的用户名\.codemuse\config.json
```

配置文件示例：

```json
{
  "schemaVersion": 1,
  "activeProfile": "deepseek",
  "profiles": [
    {
      "name": "deepseek",
      "provider": "deepseek",
      "baseUrl": "https://api.deepseek.com",
      "model": "deepseek-chat",
      "apiKeyEnv": "DEEPSEEK_API_KEY"
    },
    {
      "name": "glm",
      "provider": "glm",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
      "model": "glm-5.2",
      "apiKeyEnv": "ZHIPUAI_API_KEY"
    },
    {
      "name": "glm-flash",
      "provider": "glm",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
      "model": "glm-4.7-flash",
      "apiKeyEnv": "ZHIPUAI_API_KEY"
    },
    {
      "name": "openai",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-4.1-mini",
      "apiKeyEnv": "OPENAI_API_KEY"
    }
  ]
}
```

配置文件不得添加 `apiKey` 字段。CodeMuse 会拒绝未知字段和明文 Key。

### 2. 在 PowerShell 设置 API Key

同一个 PowerShell 窗口中可以同时设置多个服务：

```powershell
$env:DEEPSEEK_API_KEY="你的 DeepSeek API Key"
$env:ZHIPUAI_API_KEY="你的 GLM API Key"
$env:OPENAI_API_KEY="你的 OpenAI API Key"

codemuse .
```

自定义服务可在配置文件增加 Profile，并通过 `apiKeyEnv` 指定独立环境变量，例如 `LAB_MODEL_API_KEY`。

API Key 不得写入项目代码、`.env`、本机 Profile JSON、README、Issue、截图或 Git 提交。

### 3. 查看、切换和测试

```text
/model
/model list
/model use deepseek
/model use glm
/model use glm-flash
/model use mock
/model test
/model test openai
/model reload
/usage
```

- `/model use` 只能在没有任务运行时切换。
- 切换会保留当前 Agent 计划、上下文和当前进程的 `/undo` 日志。
- `/model test` 会发送一个最多生成 1 Token 的真实 API 请求，可能产生极少量计费。
- 修改配置 JSON 后使用 `/model reload`；新增环境变量通常需要退出 CodeMuse，在设置变量的 PowerShell 中重新启动。
- `/usage` 统计当前 CodeMuse 进程收到的 API usage，不是供应商账户总账单。

内置 glm 使用 glm-5.2；限时免费结束后可直接切换到共用同一 Key 的 glm-flash（glm-4.7-flash）。模型价格和免费额度以智谱控制台为准。

### 4. 超时和重试

每个 Profile 可选：

```json
{
  "timeoutMs": 30000,
  "maxRetries": 2
}
```

- `timeoutMs`：5000 到 120000，默认 30000。
- `maxRetries`：0 到 5，默认 2。
- 只重试临时网络错误、429、500、502、503 和 504。
- 400、401、403 等配置或鉴权错误不重试。
- 只重试尚未开始读取流式正文的请求，避免重复执行已经返回的 Tool Call。

### 5. 旧环境变量方式

原有方式继续有效：

```powershell
$env:CODEMUSE_PROVIDER="deepseek"
$env:CODEMUSE_API_KEY="你的 API Key"
$env:CODEMUSE_MODEL="deepseek-chat"
codemuse .
```

自定义 Provider 仍可设置 `CODEMUSE_BASE_URL`。还可使用 `CODEMUSE_TIMEOUT_MS` 和 `CODEMUSE_MAX_RETRIES`。

模型名称、价格和免费额度可能由服务商调整，应以对应平台当前控制台和文档为准。

## 允许执行的 npm scripts

允许名称：

```text
test
test:unit
build
build:production
lint
lint:fix
typecheck
check
format:check
```

拒绝示例：

```text
dev
start
serve
install
prepare
pretest
posttest
deploy
publish
```

即使名称允许，CodeMuse 仍会展示 `package.json` 中的完整脚本内容并等待用户输入 `y`。脚本内容属于目标项目代码，确认前必须阅读。

## 自动修复停止条件

- 相同脚本产生相同失败指纹两次：停止。
- 单个任务已经应用三个修复补丁：拒绝第四个补丁。
- 达到 20 个模型轮次：停止。
- 用户拒绝写入或执行：不绕过授权。
- 用户取消任务：终止当前脚本进程树。
- 停止后不再向模型提供工具，只允许它总结证据和人工下一步。

## 会话历史与恢复

每条自然语言任务结束后，CodeMuse 将安全摘要保存在目标项目：

```text
.codemuse/sessions/<UUID>.json
```

查看最近 10 条：

```text
/history
```

恢复最新一条或指定 ID 前缀：

```text
/resume
/resume 1a2b3c4d
```

恢复后可以使用 `/plan`、`/context` 查看旧状态。下一条自然语言任务会收到旧任务、状态、计划和最近 10 条有限活动摘要；Agent 仍会重新扫描项目，并把历史内容视为不可信背景。

恢复前会比较项目文件清单、大小和修改时间。工作区变化或原扫描被截断时拒绝恢复，没有强制绕过选项。

会话不保存完整 Diff、stdout/stderr、模型逐字回答或明文 API Key，也不会重放旧写入和脚本。`/undo` 仍只支持当前 CodeMuse 进程中的最近修改。

CodeMuse 扫描会忽略 `.codemuse/`。建议在目标项目的 `.gitignore` 中加入：

```gitignore
.codemuse/
```

`/clear` 只清空当前终端状态，不删除历史会话。

## CLI 命令

```text
/help                 查看帮助
/model                查看当前模型和配置路径
/model list           查看全部 Profile
/model use <NAME>     切换模型或 mock
/model test [NAME]    测试 API 连接
/model init           创建本机配置模板
/model reload         重新读取配置
/usage                查看当前进程 Token 用量
/workspace            查看当前工作区
/plan                 查看最近一次任务计划
/context              查看最近一次上下文选择
/scan                 重新扫描当前项目
/undo                 撤销当前进程最近一次任务修改
/history              查看最近 10 条会话
/resume [ID]          恢复最新或指定会话
/clear                清空终端和当前任务状态
/cancel               取消当前任务
/exit                 退出 CodeMuse
```

`npm test` 等 PowerShell 命令不能输入到 `codemuse>` 中，必须先输入 `/exit` 返回 PowerShell。

## 完整版本路线图

| 版本 | 目标 | 主要交付 | 状态 |
|---|---|---|---|
| v0.1.0 | CLI 与模型基线 | REPL、流式事件、Mock、DeepSeek/GLM/兼容接口 | 已完成 |
| v0.2.0 | 只读代码库分析 | 工作区安全、读取、搜索、Agent Loop | 已完成 |
| v0.3.0 | 规划与上下文 | 项目扫描、任务计划、相关片段和 Token 预算 | 已完成 |
| v0.4.0 | 安全代码修改 | 局部补丁、Diff 授权、原子写入和撤销 | 已完成 |
| v0.5.0 | 构建与测试 | 受控 npm scripts、输出、退出码、超时和进程控制 | 已完成 |
| v0.6.0 | 自动错误修复 | 错误分类、位置提取、失败指纹、复测和停止策略 | 已完成 |
| v0.7.0 | 会话历史与恢复 | 本地会话存储、检查点、`/history`、`/resume` | 已完成 |
| v0.8.0 | 完整文件操作与 Git 审查 | 创建/重命名/删除授权、Git Status/Diff、变更总结 | 已完成 |
| v0.9.0 | 多模型与 API 管理 | Provider 配置、连接测试、模型切换、重试和 Token 统计 | 已完成 |
| v0.10.0 | 安装与终端体验 | npm 全局发布、首次配置、日志、跨平台兼容 | 待开发 |
| v0.11.0 | 稳定性与安全验收 | 端到端测试、权限审计、提示注入和大项目测试 | 待开发 |
| v1.0.0 | 稳定开发闭环 | 分析、修改、验证、修复、审查、恢复和正式发布 | 待开发 |

### v0.7.0 会话历史与恢复

- 在工作区 `.codemuse/sessions/` 保存结构化任务摘要。
- 记录任务、计划、上下文、工具摘要、授权结果和验证状态。
- 增加 `/history`、`/resume [ID]` 和工作区 SHA-256 检查点。
- 会话恢复前校验文件清单、大小和修改时间。
- 历史摘要作为不可信背景进入下一任务。
- 不保存明文 API Key、完整 Diff、完整命令输出或模型流式回答。
- 工作区变化、扫描截断或会话结构无效时拒绝恢复。

### v0.8.0 完整文件操作与 Git 审查

- 增加安全创建文本文件、重命名和删除工具。
- 每项文件操作展示 Diff 或明确操作清单并请求确认。
- 增加只读 `git status`、`git diff` 和当前分支信息。
- 汇总 Agent 修改和用户已有修改，避免混淆。
- 不自动 commit 或 push。

### v0.9.0 多模型与 API 管理

- 完善 DeepSeek、GLM、OpenAI 和自定义兼容 Provider。
- 提供本机 Provider 配置文件和 API 连接测试。
- 支持会话内模型查看与切换。
- 处理网络超时、429、服务端错误和重试。
- 展示 Token 使用量，不把 API Key 写入会话。

- 内置 glm-5.2 和 glm-4.7-flash 两个智谱模型 Profile，共用 ZHIPUAI_API_KEY。

### v0.10.0 安装与终端体验

- 发布可直接全局安装的 npm CLI 包。
- 提供首次启动配置向导和诊断命令。
- 完善 Windows、macOS 和 Linux 路径与进程处理。
- 增加可控日志、错误编号和故障排查信息。
- 用户无需知道 CodeMuse 源码绝对路径。

### v0.11.0 稳定性与安全验收

- 建立真实示例仓库端到端验收。
- 测试提示注入、恶意路径、敏感文件和危险脚本。
- 测试取消、超时、并发文件变化和会话损坏恢复。
- 验证多个模型服务的工具调用兼容性。
- 优化大型项目扫描、上下文选择和输出限制。

### v1.0.0 正式版

- 稳定完成“需求→计划→上下文→修改→测试→修复→Git 审查→会话恢复”。
- 发布完整安装、使用、安全和故障排查文档。
- 所有高风险操作默认拒绝或需要明确授权。
- 通过跨平台端到端验收后发布正式标签。

## 开发验证

以下命令必须在 CodeMuse 源码根目录运行：

```powershell
npm test
npm run typecheck
npm run check
```

## 文档

- [项目总纲与开发操作指南](docs/project-guide.md)
- [架构说明](docs/architecture.md)
- [版本变更记录](CHANGELOG.md)
- [v0.9.0 版本说明](docs/releases/v0.9.0.md)
- [全部版本文档](docs/releases/README.md)
- [协作规范](CONTRIBUTING.md)
