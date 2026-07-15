# CodeMuse 项目总纲与开发操作指南

> 当前实施版本：v0.9.0 多模型与 API 管理。具体变化见 [releases/v0.9.0.md](releases/v0.9.0.md)。

## 1. 项目定位

CodeMuse 是一款终端智能编程助手，支持通过自然语言完成代码库分析、任务规划、代码生成与修改、Shell 命令执行、构建测试、错误修复和 Diff 审查。系统提供流式终端交互、操作权限控制、项目上下文管理及会话恢复功能，形成从需求理解到代码验证的自动化开发闭环。

CodeMuse 不是只在终端调用一次模型的聊天程序。完整产品需要让模型在受控环境中观察项目、选择工具、获得执行结果并继续决策：

```text
用户需求
  -> 理解需求与加载会话
  -> 扫描项目并构建相关上下文
  -> 制定和更新任务计划
  -> 模型选择受控工具
  -> 读取、搜索或修改代码
  -> 执行构建、测试和静态检查
  -> 分析错误并继续修复
  -> 展示 Git Diff 和验证结果
  -> 保存会话与任务检查点
```

首期重点支持 JavaScript、TypeScript 和 Node.js 项目。完整代码保留在用户本地，只把完成当前任务所需的上下文发送给用户选择的模型服务。

## 2. 产品范围

### 2.1 计划实现

- 持续交互和流式输出的 CLI。
- DeepSeek、GLM 以及其他可配置模型服务。
- 项目文件扫描、读取与代码搜索。
- 任务规划、进度更新和 Agent Loop。
- 文件创建、局部补丁修改和撤销。
- 受控 Shell 命令、构建、测试和静态检查。
- 测试失败后的分析与多轮修复。
- Git Status、Diff 和变更审查。
- 操作风险分级和用户确认。
- 项目上下文筛选、摘要和 Token 控制。
- 任务历史、检查点和会话恢复。

### 2.2 首期暂不实现

- 多个 Agent 同时协作。
- 完整替代 VS Code 或其他 IDE。
- 默认支持所有语言和构建工具。
- 将整个项目上传到 CodeMuse 自建服务器。
- 无授权执行删除、安装、发布等高风险操作。
- 自动推送远程仓库或直接发布生产环境。

## 3. 总体架构

```text
CLI 交互层
输入 / 流式输出 / 步骤 / Diff / 授权 / 斜杠命令
                       |
Application 应用编排层
创建任务 / 恢复会话 / 组装依赖 / 转发事件
                       |
Agent Core
规划 / Agent Loop / 状态 / 停止条件 / 结果验证
          |                 |                 |
Context 上下文       Permission 权限       Session 会话
项目扫描与筛选       风险分级与确认         历史与检查点
          |                 |                 |
          +-------- Tool Runtime ------------+
                   文件 / 搜索 / 补丁
                   Shell / 测试 / Git
                              |
                       Model Provider
              DeepSeek / GLM / 自定义兼容服务
```

### 3.1 架构原则

1. CLI 只负责输入、展示和用户交互，不直接访问项目文件。
2. Application 层负责组装模块、创建任务和转发事件。
3. Agent Core 负责任务规划与循环，不依赖具体模型厂商。
4. 模型只能提出结构化工具请求，不能直接操作电脑。
5. Tool Runtime 是唯一真正读取、修改和执行本地内容的模块。
6. Permission 层在工具执行前决定允许、询问或拒绝。
7. Context 层只选择当前任务需要的代码，避免发送整个项目。
8. Session 层保存可恢复状态，但不保存明文 API Key。
9. 所有文件操作必须限制在用户选择的工作区内。

## 4. 最终推荐目录

当前阶段保持单一 CLI 项目，不需要提前拆成 Monorepo。模块随功能逐步落地：

```text
CodeMuse/
├─ src/
│  ├─ cli.ts                 # 稳定程序入口
│  ├─ cli/
│  │  ├─ repl.ts             # 持续输入循环
│  │  ├─ commands/           # /help、/model、/resume
│  │  └─ renderer/           # 消息、步骤、Diff、授权
│  ├─ application/
│  │  ├─ create-app.ts       # 组装所有依赖
│  │  ├─ task-service.ts     # 创建、取消、恢复任务
│  │  └─ event-bus.ts        # AgentEvent 分发
│  ├─ agent/
│  │  ├─ agent-loop.ts       # LLM -> Tool -> Result -> LLM
│  │  ├─ planner.ts          # 任务计划
│  │  ├─ state.ts            # Agent 状态
│  │  ├─ stop-policy.ts      # 完成、失败和轮数限制
│  │  └─ prompts.ts          # 系统提示与工具说明
│  ├─ context/
│  │  ├─ workspace.ts        # 工作区安全边界
│  │  ├─ project-scanner.ts  # 项目结构识别
│  │  ├─ context-builder.ts  # 相关上下文筛选
│  │  └─ ignore-rules.ts     # 忽略依赖、构建和敏感文件
│  ├─ tools/
│  │  ├─ registry.ts         # 工具注册、校验和调用
│  │  ├─ filesystem/         # list_files、read_file、create_file
│  │  ├─ search/             # search_code
│  │  ├─ patch/              # apply_patch、revert_task
│  │  ├─ shell/              # run_script、run_tests、run_build
│  │  └─ git/                # git_status、git_diff
│  ├─ permissions/
│  │  ├─ risk-level.ts       # read、write、execute、high-risk
│  │  ├─ policy.ts           # 授权规则
│  │  └─ approval.ts         # 终端确认
│  ├─ models/
│  │  ├─ provider.ts         # 统一模型接口
│  │  ├─ compatible-provider.ts
│  │  └─ config.ts
│  ├─ sessions/
│  │  ├─ session-store.ts
│  │  ├─ task-history.ts
│  │  └─ checkpoint.ts
│  └─ shared/
│     ├─ events.ts
│     ├─ errors.ts
│     └─ types.ts
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ fixtures/
├─ docs/
│  ├─ project-guide.md
│  ├─ architecture.md
│  ├─ security.md
│  └─ roadmap.md
├─ .env.example
├─ .gitignore
├─ CONTRIBUTING.md
├─ package.json
├─ README.md
└─ tsconfig.json
```

不要为了表面整齐一次创建所有空目录。每次迭代只增加真正需要的模块和测试。

## 5. 核心接口

### 5.1 AgentEvent

所有执行过程通过事件发送给 CLI。现有事件继续保留，后续扩展：

```ts
type AgentEvent =
  | { type: "plan-updated"; steps: PlanStep[] }
  | { type: "tool-start"; call: ToolCall }
  | { type: "tool-result"; result: ToolResult }
  | { type: "approval-required"; request: ApprovalRequest }
  | { type: "diff-ready"; diff: FileDiff[] }
  | { type: "checkpoint-saved"; sessionId: string }
  | { type: "complete"; summary: TaskSummary };
```

以后即使将 CLI 更换为 Electron，也能复用同一套 Agent Core。

### 5.2 ModelProvider

```ts
interface ModelProvider {
  readonly name: string;
  chat(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}
```

统一响应需要表达文本、工具调用、Token 统计和停止原因。DeepSeek、GLM 的差异只存在于适配器内部。

### 5.3 AgentTool

```ts
interface AgentTool<TInput, TOutput> {
  readonly name: string;
  readonly description: string;
  readonly risk: "read" | "write" | "execute" | "high-risk";
  validate(input: unknown): TInput;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}
```

模型输出必须先经过工具查找、参数校验和权限判断，才能执行。

## 6. 当前版本完成情况

### 6.1 v0.1.0 CLI 与模型基线

- 持续输入、流式输出、取消和模型配置。

### 6.2 v0.2.0 只读代码库分析

- 工作区安全和 `list_files`、`read_file`、`search_code`。
- `LLM -> Tool Call -> Tool Result -> LLM` Agent Loop。

### 6.3 v0.3.0 规划与上下文

- 项目扫描、任务计划、代码片段选择和 Token 预算。
- `/plan`、`/context` 和 `/scan`。

### 6.4 v0.4.0 安全局部修改

- `apply_patch`、Diff 授权、安全写入和 `/undo`。
- 唯一匹配、整文件覆盖和并发变化保护。

### 6.5 v0.5.0 受控验证

- `list_scripts` 解析根目录 `package.json`。
- `run_script` 执行允许的 npm 验证脚本。
- 执行授权、超时、输出上限、退出码和进程树终止。
- 敏感环境变量清理。
- 共 34 项自动测试和 TypeScript 类型检查。

### 6.6 v0.6.0 错误诊断与自动修复

- 从失败 stdout/stderr 提取错误类别、关键行和工作区源码位置。
- 对归一化失败生成稳定指纹。
- 修复补丁后要求重新运行原脚本。
- 相同失败第二次出现时停止。
- 单任务最多三个已应用修复补丁。
- 停止后移除模型工具，只允许总结。
- 共 38 项自动测试和 TypeScript 类型检查。

### 6.7 v0.7.0 会话历史与恢复

- 在 `.codemuse/sessions/` 保存任务结束时的安全摘要。
- `/history` 显示最近 10 条，最多保留 50 条。
- `/resume [ID]` 恢复最新或唯一 ID 前缀会话。
- 工作区文件清单、大小和修改时间 SHA-256 检查点。
- 恢复旧计划和上下文，并把有限历史摘要加入下一任务。
- API Key 脱敏，不保存完整 Diff、命令输出和模型逐字回答。
- 共 43 项自动测试和 TypeScript 类型检查。

### 6.8 v0.8.0 文件操作与 Git 审查

- 安全创建最多 100 KB 的 UTF-8 文本文件。
- 已读取普通文本文件的重命名和删除。
- 新建、修改、重命名、删除的混合任务级撤销。
- 当前分支、Git Status、未暂存/已暂存 Diff。
- 首次写入前的 Git 状态基线和变更归属。
- Git 超时、输出限制、敏感环境变量和敏感路径过滤。
- 共 51 项自动测试和 TypeScript 类型检查。

### 6.9 v0.9.0 多模型与 API 管理

- DeepSeek、GLM、OpenAI、自定义兼容 Provider Profile。
- 本机 `~/.codemuse/config.json` 配置模板和严格 schema 校验。
- Profile 只引用 API Key 环境变量名，拒绝明文 `apiKey` 字段。
- `/model list|use|test|init|reload` 和 `/usage`。
- 会话内切换模型并保留 Agent 状态和 ToolRegistry。
- 网络错误、429、500/502/503/504 有限重试。
- 401/403 等鉴权错误不重试。
- API 返回 Token 用量解析、终端展示和会话安全摘要。
- 共 63 项自动测试和 TypeScript 类型检查。

### 6.10 当前能力边界

v0.9.0 可以分析、修改普通文本、受控验证、自动修复、只读 Git 审查、恢复会话，并在同一 CLI 进程切换多个已配置模型。所有写入和执行仍需用户确认。它不能运行任意 Shell、自动安装依赖、执行 Git 写操作，也不会把 API Key 写入本机 Profile 或会话。Token 统计依赖供应商返回 usage，不等同于账户账单。

## 7. CLI 与 package.json 操作指南

### 7.1 CodeMuse 源码开发必须进入 package.json 所在目录

`npm install`、`npm test`、`npm run typecheck` 和 `npm link` 会读取当前目录的 `package.json`：

```powershell
cd "C:\Users\Administrator\Documents\Codex\2026-07-13\u-an\CodeMuse"
Test-Path .\package.json
npm test
npm run typecheck
```

`Test-Path` 必须返回 `True`。不能把 PowerShell 显示的 `PS C:\...>` 提示符当作命令输入。

从任意目录也可以：

```powershell
npm --prefix "C:\Users\Administrator\Documents\Codex\2026-07-13\u-an\CodeMuse" test
```

### 7.2 其他成员首次安装

```powershell
git clone https://github.com/huiqwq/CodeMuse.git
cd CodeMuse
npm install
npm test
npm run typecheck
npm link
```

每个人的绝对路径可以不同，只要进入自己电脑上包含 CodeMuse `package.json` 的目录。

### 7.3 使用全局命令

```powershell
cd "D:\projects\my-app"
codemuse .
```

目标项目没有 `package.json` 时仍可扫描、读取、搜索、局部修改、新建、重命名、删除和使用 Git 只读审查；只有 npm scripts、构建和测试功能不可用。

目标项目使用脚本功能时，根目录至少需要：

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

### 7.4 CodeMuse 内部命令

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

写入、撤销或脚本执行时必须检查展示内容。只有输入 `y` 或 `yes` 才授权。

### 7.5 会话历史与恢复

任务结束后自动保存到：

```text
.codemuse/sessions/<UUID>.json
```

`/history` 查看最近 10 条；`/resume` 恢复最新一条；`/resume 1a2b3c4d` 通过 ID 前缀恢复。

恢复前重新计算工作区检查点。文件数量、大小或修改时间变化，或者原扫描被截断时，均拒绝恢复。恢复后旧计划和上下文可查看，下一条任务会获得有限历史摘要并重新扫描当前项目。

会话不保存完整 Diff、完整 stdout/stderr、模型逐字回答或明文 API Key，不自动重放旧工具。`/undo` 仍只支持当前进程。建议目标项目 `.gitignore` 加入 `.codemuse/`。

### 7.6 文件操作与 Git 审查

使用真实模型时，可以直接提出：

```text
新建 src/config.ts，写入配置类型
把 src/old-name.ts 重命名为 src/new-name.ts
删除已经不用的 src/legacy.ts
查看当前 Git 状态并总结本次改动
查看 src/index.ts 的 Git Diff
```

`rename_file` 和 `delete_file` 会先读取目标文件。每个新建、重命名或删除操作都单独显示 Diff 或路径清单，只有输入 `y` 才执行。新建文件的父目录必须已经存在；只支持工作区内允许的普通 UTF-8 文本。

`git_status` 和 `git_diff` 只读。它们不会执行 `git add`、`commit`、`checkout`、`reset` 或 `push`。最终提交仍由用户在 PowerShell 中完成。

### 7.7 多模型配置与切换

创建配置模板：

```text
codemuse> /model init
```

默认文件位于 `C:\Users\用户名\.codemuse\config.json`。它只保存 Profile 参数和 `apiKeyEnv`，不保存真实 Key。

在启动 CodeMuse 的 PowerShell 中设置：

```powershell
$env:DEEPSEEK_API_KEY="你的 DeepSeek API Key"
$env:ZHIPUAI_API_KEY="你的 GLM API Key"
$env:OPENAI_API_KEY="你的 OpenAI API Key"
codemuse .
```

终端命令：

```text
/model
/model list
/model use deepseek
/model use glm
/model use glm-flash
/model use openai
/model use mock
/model test [NAME]
/model reload
/usage
```

切换只能在任务之间进行，切换后保留计划、上下文和当前进程最近修改的 `/undo` 能力。连接测试是最多生成 1 Token 的真实请求。修改配置文件后可 reload；如果新增了环境变量，应退出并从已经设置变量的 PowerShell 重新启动。

内置 glm 使用 glm-5.2，glm-flash 使用 glm-4.7-flash，两者共用 ZHIPUAI_API_KEY。限时免费结束或需要降低成本时，可直接执行 /model use glm-flash；模型价格和免费额度以智谱控制台为准。

每个 Profile 可设置 `timeoutMs`（5000-120000）和 `maxRetries`（0-5）。系统只重试临时网络错误、429 和指定 5xx，不重试 400/401/403。

旧的 `CODEMUSE_PROVIDER`、`CODEMUSE_API_KEY`、`CODEMUSE_BASE_URL` 和 `CODEMUSE_MODEL` 继续兼容。

“OpenAI-compatible”是协议兼容层，不代表只能使用 OpenAI。模型名称、价格和免费额度以服务商当前控制台为准。真实 API Key 不得写入代码、`.env`、Profile JSON、README、Issue、截图或 Git 提交。
## 8. 已完成闭环与后续模块

### 8.1 v0.1.0 至 v0.9.0 已完成

```text
CLI 输入
  -> ProfileStore + ManagedAgent
  -> /model 选择 Provider
  -> TaskPlanner + ContextSelector
  -> ModelAgent
  -> CompatibleProvider 超时 / 重试 / Token 采集
  -> 读取与搜索
  -> apply_patch / create_file / rename_file / delete_file
  -> Diff 或操作清单 + 逐项授权
  -> Git 状态基线 + git_status / git_diff
  -> list_scripts
  -> run_script + 授权
  -> FailureDiagnostics
  -> 读取相关代码并修复
  -> 重新运行原脚本
  -> 成功或 RepairPolicy 停止
  -> Agent 文件操作与 Git 归属总结
  -> /usage 汇总 API Token
  -> SessionRecorder + WorkspaceCheckpoint
  -> /history + /resume
```

Tool Runtime 是唯一读取、修改和执行项目脚本的模块。模型不能直接操作文件或 Shell。自动修复不会绕过写入和执行授权。

### 8.2 v0.7.0 已完成的会话恢复

- 任务结束时保存结构化安全摘要和工作区检查点。
- `/history`、`/resume [ID]`、Agent 状态恢复和下一任务摘要。
- 工作区变化、扫描截断、越界目录和无效 schema 拒绝。
- API Key 脱敏，完整 Diff、命令输出和模型回答不持久化。

### 8.3 v0.8.0 已完成的文件操作与 Git 审查

- `create_file` 安全创建最多 100 KB 的 UTF-8 文本文件。
- `rename_file`、`delete_file` 要求先读取，拒绝符号链接、二进制和敏感路径。
- 所有操作展示 Diff 或文件清单并请求确认。
- ChangeJournal 支持混合操作的任务级逆序撤销。
- 只读 Git Status、Diff 和分支信息，带超时、输出上限和敏感路径过滤。
- 首次写入前保存基线，区分用户原有、Agent 和共同修改。
- 最终输出 Agent 文件操作摘要，默认不自动 commit 或 push。

### 8.4 v0.9.0 已完成的多模型与 API 管理

- DeepSeek、GLM、OpenAI 和自定义兼容 Profile。
- 本机配置模板、严格字段校验和 API Key 环境变量引用。
- `/model` 查看、切换、连接测试、初始化和重新加载。
- 网络超时、临时错误有限重试及鉴权错误快速失败。
- 服务端 Token 用量实时展示、当前进程汇总和会话摘要。
- API Key 不写入项目、Profile、终端列表、错误详情或会话。

- glm-5.2 与 glm-4.7-flash 内置 Profile 和一条命令切换。

### 8.5 v0.10.0 安装与终端体验

- 发布可全局安装的 npm CLI 包。
- 首次配置向导、诊断命令和可控日志。
- Windows、macOS 和 Linux 兼容。
- 用户不再依赖开发源码绝对路径。

### 8.6 v0.11.0 稳定性与安全验收

- 真实示例仓库端到端测试。
- 提示注入、恶意路径、敏感文件和危险脚本测试。
- 取消、超时、并发变化和会话损坏恢复测试。
- 多模型工具调用兼容性和大项目性能测试。

### 8.7 v1.0.0 稳定开发闭环

稳定完成“需求→计划→上下文→修改→测试→修复→Git 审查→会话恢复”，通过跨平台验收后正式发布。

## 9. 完整版本路线图

| 版本 | 目标 | 完成标准 |
|---|---|---|
| v0.1.0 | CLI 与模型基线 | 交互、流式事件、Mock 和兼容模型调用 |
| v0.2.0 | 只读项目分析 | 安全列出、读取和搜索代码 |
| v0.3.0 | 规划与上下文 | 任务计划、项目扫描和 Token 控制 |
| v0.4.0 | 安全代码修改 | 补丁、Diff、授权、原子写入和撤销 |
| v0.5.0 | 构建与测试 | 受控 npm scripts、输出、超时和退出码 |
| v0.6.0 | 自动错误修复 | 诊断、失败指纹、复测和停止策略 |
| v0.7.0 | 会话恢复 | 历史、检查点、`/history` 和 `/resume` |
| v0.8.0 | 文件与 Git 审查 | 完整文件操作、Status、Diff 和变更总结 |
| v0.9.0 | 模型与 API 管理 | Provider 配置、连接测试、切换、重试和统计 |
| v0.10.0 | 安装与体验 | npm 发布、配置向导、日志和跨平台 |
| v0.11.0 | 稳定性与安全 | 端到端、安全、兼容性和性能验收 |
| v1.0.0 | 正式开发闭环 | 分析、修改、验证、修复、审查和恢复稳定运行 |

## 10. 四人分工

| 成员 | 主责 | 对应模块 |
|---|---|---|
| A | Agent 核心 | `agent/`、计划、循环、停止策略 |
| B | 本地工具与安全 | `context/`、`tools/`、`permissions/` |
| C | 模型与会话 | `models/`、`sessions/`、配置和统计 |
| D | CLI 与体验 | `cli/`、renderer、Diff、授权交互 |

公共接口需要全组评审：`AgentEvent`、`ModelProvider`、`AgentTool`、`ToolResult` 和 `ApprovalRequest`。

## 11. Git 提交方式

当前小组采用直接提交 `main` 的简单流程，不额外维护 `develop`、功能分支或 PR。

开始开发前：

```powershell
git switch main
git pull origin main
git status
```

完成开发后：

```powershell
npm test
npm run typecheck
git add .
git status
git commit -m "feat: describe the feature"
git push origin main
```

每个正式版本还要创建标签：

```powershell
git tag -a v0.9.0 -m "CodeMuse v0.9.0"
git push origin v0.9.0
```

四名成员开始修改前应在小组中说明负责文件，避免同时修改同一模块。推送前先同步远程；遇到冲突时解决冲突并重新运行测试。

提交类型：

```text
feat: 新功能
fix: 修复缺陷
test: 测试
docs: 文档
refactor: 不改变行为的重构
chore: 配置和工具维护
```

不得提交真实 API Key、`.env`、`node_modules` 或个人缓存。

## 12. MVP 最终验收场景

准备一个带测试的 TypeScript 示例项目，输入：

> 为待办接口增加标题非空和长度校验，补充单元测试，并确保现有测试全部通过。

CodeMuse 应完成：

1. 识别项目结构、依赖和脚本。
2. 搜索接口、验证逻辑和现有测试。
3. 展示并更新任务计划。
4. 生成局部代码补丁和测试。
5. 展示 Diff 并请求写入授权。
6. 执行测试和构建。
7. 测试失败时分析错误并继续修复。
8. 测试通过后展示 Git Status、最终 Diff、变更归属、命令结果和任务摘要。
9. 保存会话，支持稍后恢复和查看历史。

当这条链路稳定完成时，CodeMuse 才形成真正的终端智能编程 Agent 闭环。
