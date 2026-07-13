# CodeMuse

CodeMuse 是一款终端智能编程助手，支持通过自然语言完成代码库分析、任务规划、代码生成与修改、受控项目脚本、构建测试、错误分析和 Diff 审查。系统提供流式终端交互、操作权限控制、项目上下文管理及会话恢复能力，目标是形成从需求理解到代码验证的自动化开发闭环。

当前版本：**v0.5.0 受控 npm 脚本与验证**。

## v0.5.0 当前能力

- 持续交互和流式输出的终端 CLI。
- DeepSeek、GLM 和自定义 OpenAI-compatible 模型配置。
- 项目扫描、四步任务计划、上下文选择和 Token 预算。
- `list_files`、`read_file`、`search_code` 只读工具。
- `apply_patch`、Diff 授权、安全写入和 `/undo`。
- `list_scripts` 读取项目根目录 `package.json` 的 scripts。
- `run_script` 执行允许的测试、构建、检查和类型检查脚本。
- 运行前展示真实脚本内容，必须由用户输入 `y` 授权。
- 不接受任意 Shell 字符串或额外参数。
- 禁用自动 `pre*`/`post*` 生命周期脚本。
- 最长 120 秒超时、80 KB 输出上限、退出码和 stdout/stderr 返回。
- 取消或超时时终止脚本进程树。
- 不向项目脚本传递模型 API Key、Token、Secret 或 Password 环境变量。
- 34 项自动测试及 TypeScript 静态检查。

当前版本不能创建、删除或重命名文件，不能执行任意 Shell、Git 写操作或 npm 安装/发布脚本。

## package.json 什么时候必须有

这里要区分“开发 CodeMuse”和“使用 CodeMuse 分析其他项目”。

### 开发和测试 CodeMuse：必须有

`npm install`、`npm test`、`npm run typecheck`、`npm link` 都会在当前目录查找 `package.json`。因此必须先进入 CodeMuse 源码根目录：

```powershell
cd "C:\Users\Administrator\Documents\Codex\2026-07-13\u-an\CodeMuse"
Test-Path .\package.json
npm test
npm run typecheck
```

`Test-Path` 应返回：

```text
True
```

如果提示符仍然是：

```text
PS C:\Users\Administrator>
```

直接执行 `npm test` 会报 `ENOENT`，因为 `C:\Users\Administrator` 下没有 CodeMuse 的 `package.json`。

也可以从任意位置指定 CodeMuse 目录：

```powershell
npm --prefix "C:\Users\Administrator\Documents\Codex\2026-07-13\u-an\CodeMuse" test
```

### 使用 codemuse 分析项目：不一定有

执行过一次 `npm link` 后，可以在任何项目目录运行：

```powershell
cd "D:\projects\my-app"
codemuse .
```

目标项目没有 `package.json` 时，CodeMuse 仍可以：

- 扫描目录。
- 读取和搜索代码。
- 在真实模型模式下提出局部补丁。

但以下 v0.5.0 功能必须要求目标项目根目录存在 `package.json`：

- `list_scripts` 查看 npm scripts。
- `run_script` 执行 test、build、lint、typecheck 或 check。
- 通过 npm scripts 进行构建和测试验证。

`package.json` 至少应包含：

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

CodeMuse 不会为了运行脚本自动创建 `package.json`。

## 其他成员首次使用

每个人只需要使用自己电脑上的目录，不需要与你的绝对路径相同：

```powershell
git clone https://github.com/huiqwq/CodeMuse.git
cd CodeMuse
npm install
npm test
npm run typecheck
npm link
```

之后可以离开 CodeMuse 源码目录：

```powershell
cd "D:\projects\其他项目"
codemuse .
```

## 执行流程

```text
用户任务
  -> 扫描项目、计划和选择上下文
  -> 读取与修改代码
  -> list_scripts 读取 package.json
  -> 只选择允许的验证脚本
  -> 展示 npm 命令和真实脚本内容
  -> 用户输入 y
  -> 清理敏感环境变量
  -> 结构化启动 npm，不拼接 Shell 字符串
  -> 返回退出码、stdout、stderr 和超时状态
  -> 模型分析验证结果
```

## 允许执行的脚本

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

即使脚本名称允许，CodeMuse 仍会展示 `package.json` 中的完整脚本内容并请求确认。脚本内容来自项目，可能具有风险，确认前必须阅读。

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

## 启动与模型配置

Mock 模式：

```powershell
codemuse .
```

Mock 会真实扫描和筛选代码，但不会生成补丁或执行项目脚本。

DeepSeek：

```powershell
$env:CODEMUSE_PROVIDER="deepseek"
$env:CODEMUSE_API_KEY="你的 API Key"
$env:CODEMUSE_MODEL="deepseek-chat"
codemuse .
```

GLM：

```powershell
$env:CODEMUSE_PROVIDER="glm"
$env:CODEMUSE_API_KEY="你的 API Key"
$env:CODEMUSE_MODEL="以平台当前可用模型为准"
codemuse .
```

真实 API Key 不得写入代码、`.env`、文档、Issue、截图或 Git 提交。

## 验证

```powershell
npm test
npm run typecheck
```

## 文档

- [项目总纲与开发操作指南](docs/project-guide.md)
- [架构说明](docs/architecture.md)
- [版本变更记录](CHANGELOG.md)
- [v0.5.0 版本说明](docs/releases/v0.5.0.md)
- [协作规范](CONTRIBUTING.md)

## 路线图

1. `v0.1.0`：CLI、流式模型调用和基础事件。
2. `v0.2.0`：工作区安全、只读工具和 Agent Loop。
3. `v0.3.0`：任务规划、项目扫描、上下文筛选和 Token 控制。
4. `v0.4.0`：局部补丁、Diff 确认、安全写入和撤销。
5. `v0.5.0`：受控 npm scripts、构建、测试和退出码。
6. `v0.6.0`：错误反馈与自动修复。
7. `v0.7.0`：会话历史和恢复。
8. `v1.0.0`：完整、稳定的自动化开发闭环。
