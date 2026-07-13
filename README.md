# CodeMuse

CodeMuse 是一款终端智能编程助手，支持通过自然语言完成代码库分析、任务规划、代码生成与修改、Shell 命令执行、构建测试、错误修复和 Diff 审查。系统提供流式终端交互、操作权限控制、项目上下文管理及会话恢复能力，目标是形成从需求理解到代码验证的自动化开发闭环。

当前版本：**v0.3.0 任务规划与智能上下文管理**。

## v0.3.0 当前能力

- 持续交互和流式输出的终端 CLI。
- DeepSeek、GLM 和自定义 OpenAI-compatible 模型配置。
- 安全扫描项目，识别项目名称、技术栈、语言、框架、包管理器和关键文件。
- 为每个任务建立“扫描、选择上下文、分析、返回结果”四步计划。
- 根据任务关键词、文件路径和实际内容对候选文件进行相关性排序。
- 在 Token 预算内只选择相关代码片段，不上传整个项目。
- `/plan`、`/context`、`/scan` 查看任务状态和项目上下文。
- `list_files`、`read_file`、`search_code` 三个只读工具。
- `LLM -> Tool Call -> Tool Result -> LLM` 只读 Agent Loop。
- 工作区路径越界、符号链接、敏感文件、依赖目录和构建目录保护。
- Mock 模式执行真实的本地扫描、读取、筛选和 Token 控制。
- 18 项自动测试及 TypeScript 静态检查。

当前版本仍然不能修改文件、执行 Shell 或 Git 写操作。

## 执行流程

```text
自然语言任务
  -> 项目扫描与技术栈识别
  -> 生成任务计划
  -> 相关文件评分
  -> Token 预算内选择代码片段
  -> 模型分析并按需调用只读工具
  -> 返回带文件证据的结果
```

项目代码保留在用户电脑。只有当前任务选择出的代码片段和后续只读工具结果会发送到用户配置的模型服务。

## 环境要求

- Node.js 22.18.0 或更高版本。
- Windows PowerShell、Windows Terminal、macOS Terminal 或常见 Linux 终端。

首次克隆后：

```powershell
npm install
npm run typecheck
npm link
```

`npm link` 成功后，`codemuse` 可以在任意目录使用。源码目录移动或重新安装 Node.js 后需要重新执行一次。

## 启动

分析当前目录：

```powershell
codemuse .
```

分析指定项目：

```powershell
codemuse "D:\projects\my-app"
```

未注册全局命令时：

```powershell
cd "C:\Users\Administrator\Documents\Codex\2026-07-13\u-an\CodeMuse"
node src\cli.ts .
```

没有配置 API Key 时自动进入 Mock 模式。Mock 不进行模型推理，但项目扫描、代码读取、上下文筛选和 Token 估算均为真实本地操作。

## CLI 命令

```text
/help       查看帮助
/model      查看当前模型
/workspace  查看当前工作区
/plan       查看最近一次任务计划
/context    查看最近一次上下文选择
/scan       重新扫描当前项目
/clear      清空终端和当前任务状态
/cancel     取消当前任务
/exit       退出 CodeMuse
```

需要查看最终计划和上下文时，请等待任务完成并重新出现 `codemuse>`，再输入 `/plan` 或 `/context`。任务运行期间这两个命令显示的是实时状态，`/scan` 和 `/clear` 会被拒绝；可使用 `/cancel` 取消任务。

## Token 预算

默认最多为当前任务预选约 6000 Tokens 的代码上下文。可在启动前调整：

```powershell
$env:CODEMUSE_CONTEXT_TOKENS="8000"
codemuse .
```

允许范围为 500 到 100000。该数值控制 CodeMuse 主动选择的初始代码片段，不代表模型厂商账户的总额度。

## 接入 DeepSeek

```powershell
$env:CODEMUSE_PROVIDER="deepseek"
$env:CODEMUSE_API_KEY="你的 API Key"
$env:CODEMUSE_BASE_URL="https://api.deepseek.com"
$env:CODEMUSE_MODEL="deepseek-chat"
codemuse .
```

## 接入 GLM

```powershell
$env:CODEMUSE_PROVIDER="glm"
$env:CODEMUSE_API_KEY="你的 API Key"
$env:CODEMUSE_BASE_URL="https://open.bigmodel.cn/api/paas/v4"
$env:CODEMUSE_MODEL="以平台当前可用模型为准"
codemuse .
```

真实 API Key 不得写入代码、文档、Issue、截图或 Git 提交。

## 验证

先输入 `/exit` 退出 CodeMuse，再在 PowerShell 中执行：

```powershell
npm test
npm run typecheck
```

## 文档

- [项目总纲与开发操作指南](docs/project-guide.md)
- [架构说明](docs/architecture.md)
- [版本变更记录](CHANGELOG.md)
- [v0.3.0 版本说明](docs/releases/v0.3.0.md)
- [协作规范](CONTRIBUTING.md)

## 路线图

1. `v0.1.0`：CLI、流式模型调用和基础事件。
2. `v0.2.0`：工作区安全、只读工具和 Agent Loop。
3. `v0.3.0`：任务规划、项目扫描、上下文筛选和 Token 控制。
4. `v0.4.0`：补丁修改、Diff 审核、授权和撤销。
5. `v0.5.0`：受控 Shell、构建和测试。
6. `v0.6.0`：错误反馈与自动修复。
7. `v0.7.0`：会话历史和恢复。
8. `v1.0.0`：完整、稳定的自动化开发闭环。
