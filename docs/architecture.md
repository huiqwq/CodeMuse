# CodeMuse 架构

## v0.6.0 执行链路

```text
CLI 自然语言任务
  -> ProjectScanner + TaskPlanner + ContextSelector
  -> ModelAgent
  -> ToolRegistry
       ├─ list_files / read_file / search_code
       ├─ apply_patch -> Diff -> 授权 -> AtomicWrite -> ChangeJournal
       └─ list_scripts -> run_script -> 授权 -> ProcessRunner
                                      -> stdout / stderr / exitCode
  -> FailureDiagnostics
       -> 错误分类
       -> 关键错误摘要
       -> 工作区源码路径与行列号
       -> 稳定失败指纹
  -> RepairPolicy
       -> 模型读取相关代码
       -> 用户确认修复补丁
       -> 重新执行原脚本
       -> 验证成功
          或相同失败两次 / 三补丁上限 / 20 模型轮次后停止
```

## 当前模块

```text
src/
├─ agent/
│  ├─ agent-state.ts
│  ├─ failure-diagnostics.ts
│  ├─ model-agent.ts
│  ├─ mock-agent.ts
│  ├─ repair-policy.ts
│  └─ task-planner.ts
├─ changes/
├─ context/
├─ models/
├─ tools/
│  ├─ filesystem/
│  ├─ patch/
│  ├─ scripts/
│  ├─ search/
│  └─ registry.ts
├─ ui/
├─ commands/
└─ cli.ts
```

## FailureDiagnostics

`failure-diagnostics.ts` 只处理已执行且未成功的 `run_script` 结果：

- 按 timeout、typecheck、test、lint、build 或 runtime 分类。
- 从 stderr 和 stdout 选择有限的关键行。
- 提取工作区内 TypeScript、JavaScript、JSON、Vue、Svelte、CSS 和 HTML 位置。
- 拒绝工作区外路径以及 `node_modules`、`dist`、`build`、`coverage` 位置。
- 对工作区绝对路径、行列号和耗时做归一化。
- 计算 16 位 SHA-256 失败指纹，用于识别相同错误。
- 最多向模型提供 4000 字符诊断摘录。

诊断只作为证据，不会直接修改文件。

## RepairPolicy

每次 ModelAgent 任务创建独立的 `RepairPolicy`：

1. 第一次验证失败后，把结构化诊断附加到 Tool Result。
2. 提示模型先读取或搜索相关文件。
3. 用户明确要求修复时，模型才能提出 `apply_patch`。
4. 每个补丁继续使用 v0.4.0 的 Diff 和写入授权。
5. 补丁获批后，提示模型重新运行原失败脚本。
6. 脚本成功时发出闭环完成事件。
7. 同一脚本的相同失败指纹第二次出现时停止。
8. 单任务最多允许三个已应用修复补丁。
9. 停止后下一次模型调用不提供任何工具，只允许总结失败证据和人工下一步。
10. ModelAgent 总轮数由 12 提升为 20，但仍受修复策略限制。

## 现有安全边界

### 文件

- 只能访问工作区内允许的相对路径。
- 使用 realpath 防止符号链接越界。
- 拒绝敏感目录、二进制和超大文件。
- `apply_patch` 只能修改当前任务已读取的现有 UTF-8 文件。
- 必须唯一局部匹配，拒绝整文件覆盖。
- 写入前显示 Diff，默认拒绝。
- 写入确认期间文件发生变化时拒绝覆盖。
- 当前不能创建、删除或重命名文件。

### 脚本

- 只执行根目录 `package.json` 中允许名称的 npm scripts。
- 模型不能传入任意 Shell 字符串和额外参数。
- `shell:false`，Windows 使用 `node.exe + npm-cli.js`。
- 禁用 pre/post 生命周期脚本。
- 默认超时 60 秒、最大 120 秒，输出上限 80 KB。
- 超时或取消时终止进程树。
- 清除 API Key、Token、Secret、Password 和 Private Key 环境变量。
- 每次执行必须获得用户确认。

### 模型 API

- `CompatibleProvider` 只负责 OpenAI-compatible 流式协议。
- 当前预设 DeepSeek 和 GLM，并允许自定义 Base URL 与模型名称。
- 代码上下文按任务筛选并受 Token 预算控制。
- 项目文本按不可信数据处理，不能覆盖系统提示。
- API Key 不进入 Tool Result、脚本环境变量和版本文档。
- Provider 配置管理、连接测试、重试和 Token 统计安排在 v0.9.0。

## package.json 边界

CodeMuse 涉及两份不同角色的 `package.json`：

1. CodeMuse 源码根目录的文件定义自身版本、依赖、测试和 `codemuse` 命令。
2. 目标项目根目录的文件定义可用于验证和自动修复复测的 npm scripts。

扫描、读取、搜索和局部补丁不强制目标项目存在 `package.json`；`list_scripts`、`run_script` 和自动修复验证必须要求它存在。当前不执行 Monorepo 子包脚本。

## 后续架构扩展

- v0.7.0：新增 `sessions/`，持久化任务与检查点。
- v0.8.0：新增完整文件生命周期工具和只读 `tools/git/`。
- v0.9.0：拆分 Provider 配置、连接测试、重试与统计。
- v0.10.0：增加发布入口、诊断命令和跨平台适配。
- v0.11.0：增加端到端安全与兼容性验收。
- v1.0.0：稳定连接分析、修改、验证、修复、Git 审查与会话恢复。

完整产品范围和路线图见 [README](../README.md) 与 [project-guide.md](project-guide.md)。
