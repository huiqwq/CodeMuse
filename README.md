# CodeMuse

CodeMuse 是一个面向本地代码仓库的多模型编程 Agent。当前 `v0.1` 建立可运行的交互式 CLI、统一 Agent 事件协议和真实模型接入边界；后续逐步加入代码读取、搜索、补丁修改、权限确认、命令执行和 Git Diff。

## 当前能力

- 持续交互的终端对话。
- `/help`、`/model`、`/workspace`、`/clear`、`/cancel`、`/exit`。
- Agent 任务步骤与流式消息事件。
- 无 API Key 时自动进入 Mock 开发模式。
- 通过统一兼容接口接入 DeepSeek、GLM 或自定义模型服务。
- 零第三方运行时依赖，Node.js 22.18 以上可以直接启动。

当前版本尚未获得本地文件工具权限，因此真实模型只能对话，不能声称已经读取或修改代码。代码工具将在后续版本实现。

## 启动

```powershell
node src/cli.ts .
```

无 API Key 时会自动使用本地 Mock 模式，可立即检查终端界面和交互。

## 接入 DeepSeek

```powershell
$env:CODEMUSE_PROVIDER="deepseek"
$env:CODEMUSE_API_KEY="你的 API Key"
$env:CODEMUSE_BASE_URL="https://api.deepseek.com"
$env:CODEMUSE_MODEL="deepseek-chat"
node src/cli.ts .
```

## 接入智谱 GLM

```powershell
$env:CODEMUSE_PROVIDER="glm"
$env:CODEMUSE_API_KEY="你的 API Key"
$env:CODEMUSE_BASE_URL="https://open.bigmodel.cn/api/paas/v4"
$env:CODEMUSE_MODEL="glm-4-flash"
node src/cli.ts .
```

模型名称和免费额度会变化，以平台控制台为准。真实 API Key 不得写入代码、README、Issue 或提交记录。

## 测试

```powershell
node tests\run.ts
```

## 路线图

1. `v0.1`：CLI 对话、模型接入、Agent 事件流。
2. `v0.2`：`list_files`、`read_file`、`search_code` 只读工具。
3. `v0.3`：补丁修改、Diff 审核、权限确认和撤销。
4. `v0.4`：受控 Shell、测试反馈和循环修复。
5. `v0.5`：Git Diff、任务历史和模型配置管理。

详细架构见 [docs/architecture.md](docs/architecture.md)，协作方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 项目总纲

完整的产品架构、开发路线、CLI 操作、模块接入方式和 Git 协作规范见：

- [CodeMuse 项目总纲与开发操作指南](docs/project-guide.md)
