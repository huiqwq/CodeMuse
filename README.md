# CodeMuse

CodeMuse 是一款终端智能编程助手，支持通过自然语言完成代码库分析、任务规划、代码生成与修改、Shell 命令执行、构建测试、错误修复和 Diff 审查。系统提供流式终端交互、操作权限控制、项目上下文管理及会话恢复能力，目标是形成从需求理解到代码验证的自动化开发闭环。

当前版本：**v0.2.0 只读代码库分析 Agent**。

## v0.2.0 当前能力

- 持续交互和流式输出的终端 CLI。
- DeepSeek、GLM 和自定义 OpenAI-compatible 模型配置。
- `list_files`：查看项目目录结构。
- `read_file`：按行读取 UTF-8 文本文件。
- `search_code`：搜索关键词、函数和错误信息。
- `LLM -> Tool Call -> Tool Result -> LLM` 只读 Agent Loop。
- 工作区路径越界、符号链接、敏感文件和忽略目录保护。
- CLI 展示工具开始、完成和失败状态。
- Mock 模式执行真实本地只读工具，无 API Key 也能验收。
- 12 项自动测试。

当前版本不能修改文件、执行 Shell 或 Git 写操作。

## 环境要求

- Node.js 22.18.0 或更高版本。
- Windows PowerShell、Windows Terminal、macOS Terminal 或常见 Linux 终端。

检查：

```powershell
node --version
npm --version
```

首次克隆后安装开发依赖：

```powershell
npm install
npm run typecheck
```

## 注册全局命令

首次克隆并安装依赖后，在 CodeMuse 源码目录执行一次：

```powershell
npm link
where.exe codemuse
```

注册成功后，`codemuse` 可以在任意 PowerShell 窗口使用。源码目录移动位置或重新安装 Node.js 后，需要重新执行 `npm link`。

## 启动

分析当前目录：

```powershell
codemuse .
```

分析指定项目：

```powershell
codemuse "D:\projects\my-app"
```

未注册全局命令时，也可以从源码启动：

```powershell
cd "C:\Users\Administrator\Documents\Codex\2026-07-13\u-an\CodeMuse"
node src\cli.ts .
```

没有配置 API Key 时进入 Mock 模式。Mock 模式不进行模型推理，但会真实执行只读文件工具。

## CLI 命令

```text
/help       查看帮助
/model      查看当前模型
/workspace  查看当前工作区
/clear      清空显示
/cancel     取消当前任务
/exit       退出 CodeMuse
```

## 接入 DeepSeek

```powershell
$env:CODEMUSE_PROVIDER="deepseek"
$env:CODEMUSE_API_KEY="你的 API Key"
$env:CODEMUSE_BASE_URL="https://api.deepseek.com"
$env:CODEMUSE_MODEL="deepseek-chat"
node src\cli.ts .
```

## 接入 GLM

```powershell
$env:CODEMUSE_PROVIDER="glm"
$env:CODEMUSE_API_KEY="你的 API Key"
$env:CODEMUSE_BASE_URL="https://open.bigmodel.cn/api/paas/v4"
$env:CODEMUSE_MODEL="以平台当前可用模型为准"
node src\cli.ts .
```

真实 API Key 不得写入代码、文档、Issue、截图或 Git 提交。

## 运行测试

先输入 `/exit` 退出 CodeMuse，再在 PowerShell 中执行：

```powershell
node tests\run.ts
```

## 文档

- [项目总纲与开发操作指南](docs/project-guide.md)
- [架构说明](docs/architecture.md)
- [版本变更记录](CHANGELOG.md)
- [v0.1.0 版本说明](docs/releases/v0.1.0.md)
- [v0.2.0 版本说明](docs/releases/v0.2.0.md)
- [协作规范](CONTRIBUTING.md)

## 路线图

1. `v0.1.0`：CLI、流式模型调用和基础事件。
2. `v0.2.0`：工作区安全、只读工具和 Agent Loop。
3. `v0.3.0`：任务规划、项目扫描和上下文筛选。
4. `v0.4.0`：补丁修改、Diff 审核、授权和撤销。
5. `v0.5.0`：受控 Shell、构建和测试。
6. `v0.6.0`：错误反馈与自动修复。
7. `v0.7.0`：会话历史和恢复。
8. `v1.0.0`：完整、稳定的自动化开发闭环。
