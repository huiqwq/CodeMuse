# CodeMuse 项目总纲与开发操作指南

> 当前实施版本：v0.3.0 任务规划与智能上下文管理。具体变化见 [releases/v0.3.0.md](releases/v0.3.0.md)。

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

- 持续输入的终端 REPL、流式输出、取消和斜杠命令。
- MockAgent、ModelAgent、DeepSeek、GLM 和自定义兼容模型配置。
- API Key 缺失时自动进入 Mock 模式。

### 6.2 v0.2.0 只读代码库分析

- 工作区安全边界、真实路径和敏感文件保护。
- `list_files`、`read_file`、`search_code`。
- `LLM -> Tool Call -> Tool Result -> LLM` Agent Loop。
- Mock 模式真实执行本地只读工具。

### 6.3 v0.3.0 规划与上下文

- 项目类型、语言、框架、包管理器和关键文件识别。
- 四步任务计划及状态记录。
- 任务相关文件评分和代码片段选择。
- 默认 6000 Tokens 的可配置上下文预算。
- `/plan`、`/context` 和 `/scan`。
- 共 18 项自动测试及 TypeScript 类型检查。

### 6.4 当前能力边界

v0.3.0 是具备任务规划和智能上下文的只读 Agent。它可以真实扫描、读取和搜索项目，但不能修改文件、执行 Shell、运行测试或执行 Git 写操作。MockAgent 用于无 Key 开发和验收，不会伪装成真实模型推理。

## 7. CLI 操作指南

### 7.1 检查环境

```powershell
node --version
npm --version
where.exe node
```

当前要求 Node.js 22.18 或更高版本。

### 7.2 首次安装和全局注册

```powershell
cd "C:\Users\Administrator\Documents\Codex\2026-07-13\u-an\CodeMuse"
npm install
npm link
where.exe codemuse
```

以后分析当前目录：

```powershell
codemuse .
```

分析指定项目：

```powershell
codemuse "D:\projects\my-app"
```

无 API Key 时进入 Mock 模式，但扫描、读取、上下文选择和 Token 估算仍是真实本地操作。

### 7.3 CodeMuse 内部命令

```text
/help       查看命令
/model      查看当前模型
/workspace  查看当前工作区
/plan       查看最近一次任务计划
/context    查看最近一次上下文选择
/scan       重新扫描当前项目
/clear      清空终端和当前任务状态
/cancel     取消当前任务
/exit       退出 CodeMuse
```

`npm test` 是 PowerShell 命令，必须先输入 `/exit` 退出 CodeMuse，不能输入到 `codemuse>` 中。

### 7.4 运行测试

```powershell
npm test
npm run typecheck
```

### 7.5 调整上下文预算

```powershell
$env:CODEMUSE_CONTEXT_TOKENS="8000"
codemuse .
```

默认值为 6000，允许范围为 500 到 100000。

### 7.6 使用 DeepSeek

```powershell
$env:CODEMUSE_PROVIDER="deepseek"
$env:CODEMUSE_API_KEY="你的 API Key"
$env:CODEMUSE_BASE_URL="https://api.deepseek.com"
$env:CODEMUSE_MODEL="deepseek-chat"
codemuse .
```

### 7.7 使用 GLM

```powershell
$env:CODEMUSE_PROVIDER="glm"
$env:CODEMUSE_API_KEY="你的 API Key"
$env:CODEMUSE_BASE_URL="https://open.bigmodel.cn/api/paas/v4"
$env:CODEMUSE_MODEL="以平台当前可用模型为准"
codemuse .
```

真实 API Key 不得写入代码、README、Issue、截图或 Git 提交。

## 8. 后续功能如何结合现有代码

### 8.1 已完成的只读分析链路

v0.1.0 到 v0.3.0 已完成：

```text
CLI 输入
  -> TaskPlanner
  -> ProjectScanner
  -> ContextSelector + TokenBudget
  -> ModelAgent
  -> ToolRegistry
  -> Workspace Guard
  -> list_files / read_file / search_code
  -> 模型最终回答
```

CLI 只展示事件，不直接读取项目；模型只能通过精选上下文和受控工具获取代码。

### 8.2 v0.4.0 代码修改与 Diff

新增局部补丁、Diff 生成、写入授权和任务级撤销。流程为：读取文件 -> 校验原片段 -> 内存试应用 -> 展示 Diff -> 用户确认 -> 原子写入。禁止模型无条件覆盖整个文件。

### 8.3 v0.5.0 Shell、构建与测试

模型只能选择受控项目脚本，不能直接提供任意 Shell 字符串。执行必须包含固定工作目录、超时、输出上限、退出码、取消能力和危险模式拦截。

### 8.4 v0.6.0 自动错误修复

将测试退出码和关键错误作为 Tool Result 返回 Agent。Agent 再次搜索、修改和验证；达到最大轮数或重复相同错误时停止。

### 8.5 v0.7.0 会话恢复

数据保存在工作区 `.codemuse/`，记录任务、计划、工具调用、Diff、测试结果和状态。后续增加 `/history` 和 `/resume`。

## 9. 版本路线图

| 版本 | 目标 | 完成标准 |
|---|---|---|
| v0.1 | CLI 与模型基线 | 交互、流式事件、取消、模型适配 |
| v0.2 | 只读项目分析 | 安全列出、读取和搜索代码 |
| v0.3 | 规划与上下文 | 展示计划并控制模型上下文 |
| v0.4 | 代码修改 | 补丁、Diff、授权和撤销 |
| v0.5 | Shell 与验证 | 受控执行测试、构建和检查 |
| v0.6 | 自动修复 | 失败反馈、多轮修复、停止策略 |
| v0.7 | 会话恢复 | 历史、检查点、`/resume` |
| v1.0 | 完整闭环 | 稳定完成分析、修改、验证和审查 |

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
git tag -a v0.3.0 -m "CodeMuse v0.3.0"
git push origin v0.3.0
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
8. 测试通过后展示最终 Diff、命令结果和任务摘要。
9. 保存会话，支持稍后恢复和查看历史。

当这条链路稳定完成时，CodeMuse 才形成真正的终端智能编程 Agent 闭环。
