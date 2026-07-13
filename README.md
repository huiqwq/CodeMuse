# CodeMuse

CodeMuse 是一款终端智能编程助手，支持通过自然语言完成代码库分析、任务规划、代码生成与修改、Shell 命令执行、构建测试、错误修复和 Diff 审查。系统提供流式终端交互、操作权限控制、项目上下文管理及会话恢复能力，目标是形成从需求理解到代码验证的自动化开发闭环。

当前版本：**v0.4.0 安全局部修改与撤销**。

## v0.4.0 当前能力

- 持续交互和流式输出的终端 CLI。
- DeepSeek、GLM 和自定义 OpenAI-compatible 模型配置。
- 项目技术栈扫描、四步任务计划、相关上下文选择和 Token 预算。
- `list_files`、`read_file`、`search_code` 三个只读工具。
- `apply_patch` 精确替换已有文件中的唯一局部片段。
- 写入前展示 Unified Diff，并等待用户输入 `y` 明确授权。
- 同一任务修改归入一个变更集，`/undo` 可撤销最近一次任务修改。
- 写入与撤销前后均检查并发变化，防止覆盖用户的新修改。
- 工作区越界、符号链接、敏感文件、二进制、超大文件和整文件覆盖保护。
- 模型文本与 Diff 中的终端控制字符转义。
- 26 项自动测试及 TypeScript 静态检查。

当前版本不能创建或删除文件，不能执行 Shell、构建、测试或 Git 写操作。

## 执行流程

```text
自然语言任务
  -> 项目扫描与任务计划
  -> 相关代码片段选择
  -> 模型调用只读工具补充证据
  -> read_file 读取目标文件
  -> apply_patch 提交唯一局部替换
  -> 内存生成 Unified Diff
  -> 用户输入 y 明确授权
  -> 再次校验文件未变化
  -> 同目录临时文件安全替换
  -> 记录任务变更，支持 /undo
```

模型不能绕过 Tool Registry 直接操作电脑。没有确认处理器或用户未输入 `y` 时，写入默认拒绝。

## 环境要求

- Node.js 22.18.0 或更高版本。
- Windows PowerShell、Windows Terminal、macOS Terminal 或常见 Linux 终端。

首次克隆后：

```powershell
npm install
npm run typecheck
npm link
```

`npm link` 成功后，`codemuse` 可以在任意目录使用。

## 启动

分析或修改当前目录：

```powershell
codemuse .
```

指定其他项目：

```powershell
codemuse "D:\projects\my-app"
```

未注册全局命令时：

```powershell
node src\cli.ts .
```

没有 API Key 时自动进入 Mock 模式。Mock 会真实扫描和筛选代码，但不会伪装成模型生成补丁，也不会修改文件。

## CLI 命令

```text
/help       查看帮助
/model      查看当前模型
/workspace  查看当前工作区
/plan       查看最近一次任务计划
/context    查看最近一次上下文选择
/scan       重新扫描当前项目
/undo       撤销当前会话最近一次任务修改
/clear      清空终端和当前任务状态
/cancel     取消当前任务
/exit       退出 CodeMuse
```

`/undo` 只保留当前 CodeMuse 进程内最近一次有文件写入的任务。退出并重新启动后撤销记录不会保留。

## Diff 确认

真实模型提出修改时，终端会显示：

```diff
--- a/src/example.ts
+++ b/src/example.ts
@@ ...
-const value = 1;
+const value = 2;
```

随后出现：

```text
允许执行此操作？输入 y 确认，其他输入拒绝 [y/N]:
```

只有输入 `y` 或 `yes` 才会写入。直接回车、`n`、其他文字、`/cancel` 或 `/exit` 都不会写入。

## Token 预算

默认预选约 6000 Tokens 的任务代码上下文：

```powershell
$env:CODEMUSE_CONTEXT_TOKENS="8000"
codemuse .
```

允许范围为 500 到 100000。它控制初始代码片段，不等同于模型厂商的精确计费数字。

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

先输入 `/exit` 退出 CodeMuse，再执行：

```powershell
npm test
npm run typecheck
```

## 文档

- [项目总纲与开发操作指南](docs/project-guide.md)
- [架构说明](docs/architecture.md)
- [版本变更记录](CHANGELOG.md)
- [v0.4.0 版本说明](docs/releases/v0.4.0.md)
- [协作规范](CONTRIBUTING.md)

## 路线图

1. `v0.1.0`：CLI、流式模型调用和基础事件。
2. `v0.2.0`：工作区安全、只读工具和 Agent Loop。
3. `v0.3.0`：任务规划、项目扫描、上下文筛选和 Token 控制。
4. `v0.4.0`：局部补丁、Diff 确认、安全写入和撤销。
5. `v0.5.0`：受控 Shell、构建和测试。
6. `v0.6.0`：错误反馈与自动修复。
7. `v0.7.0`：会话历史和恢复。
8. `v1.0.0`：完整、稳定的自动化开发闭环。
