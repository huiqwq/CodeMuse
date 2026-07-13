# CodeMuse 架构

## v0.5.0 执行链路

```text
CLI 输入任务
  -> ProjectScanner + TaskPlanner + ContextSelector
  -> ModelAgent
  -> ToolRegistry
       ├─ list_files / read_file / search_code
       ├─ apply_patch -> Diff -> 授权 -> AtomicWrite -> ChangeJournal
       └─ list_scripts
            -> 读取根目录 package.json
            -> 标记允许脚本
            -> run_script
                 -> 展示脚本与执行授权
                 -> 清理敏感环境变量
                 -> Node + npm-cli.js（Windows）或 npm（Unix）
                 -> shell:false
                 -> 超时 / 取消 / 进程树终止
                 -> stdout / stderr / exitCode
  -> 命令输出显示并返回模型
```

## 当前模块

```text
src/
├─ agent/
├─ changes/
├─ context/
├─ models/
├─ tools/
│  ├─ create-coding-tools.ts
│  ├─ registry.ts
│  ├─ filesystem/
│  ├─ patch/
│  ├─ search/
│  └─ scripts/
│     ├─ list-scripts.ts
│     ├─ package-scripts.ts
│     ├─ process-runner.ts
│     └─ run-script.ts
├─ ui/
├─ commands/
└─ cli.ts
```

## package.json 边界

CodeMuse 涉及两份不同角色的 `package.json`：

1. CodeMuse 源码根目录的 `package.json` 定义自身依赖、`npm test`、`typecheck` 和 `codemuse` 全局命令。开发 CodeMuse 时必须位于该目录。
2. 被分析项目根目录的 `package.json` 定义目标项目 npm scripts。扫描、读取、搜索和局部修改不强制要求它，但 `list_scripts` 和 `run_script` 必须要求它存在。

Tool Runtime 只读取工作区根目录的 `package.json`，v0.5.0 不递归执行 Monorepo 子包脚本。

## 脚本允许策略

允许：

- `test`、`test:*`
- `build`、`build:*`
- `lint`、`lint:*`
- `typecheck`、`typecheck:*`
- `check`、`check:*`
- `format:check`

拒绝 `dev`、`start`、`install`、`prepare`、`deploy`、`publish`、`pretest`、`posttest` 等脚本。

模型不能提供 Shell 字符串或额外参数。脚本名称必须来自当前任务成功执行的 `list_scripts` 结果，运行时会重新读取 `package.json`，防止使用过期内容。

## 执行安全

- 每次执行展示固定 npm 命令和 `package.json` 中的真实脚本内容。
- 没有用户明确输入 `y` 或 `yes` 时默认拒绝。
- `shell:false`，参数通过数组传入，不拼接模型输出。
- Windows 直接使用 `node.exe` 启动 `npm-cli.js`，避免 `npm.cmd` 必须经过 Shell。
- 设置 `npm_config_ignore_scripts=true` 和 `--ignore-scripts`，禁止自动执行 pre/post 生命周期脚本。
- 默认超时 60 秒，最短 1 秒，最长 120 秒。
- stdout 与 stderr 合计最多保留 80 KB。
- 取消和超时终止进程树。
- 返回退出码、超时、截断、持续时间和输出。
- 清除名称分段包含 API_KEY、TOKEN、SECRET、PASSWORD、PRIVATE_KEY的环境变量。
- 明确清除 `CODEMUSE_API_KEY`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY` 和 `ZHIPUAI_API_KEY`。
- 脚本失败不伪装成成功，非零退出码作为 Tool Result 返回模型。

## 现有写入安全

v0.4.0 的局部补丁、Diff 授权、并发变化保护、原子写入和当前进程撤销继续保留。当前版本仍不能创建、删除或重命名文件，也不能执行 Git 写操作或任意 Shell。

完整规划见 [project-guide.md](project-guide.md)。
