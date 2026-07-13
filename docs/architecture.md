# CodeMuse 架构

## v0.3.0 执行链路

```text
CLI 输入自然语言任务
  -> ProjectScanner 扫描安全文件范围
  -> TaskPlanner 建立四步任务计划
  -> ContextSelector 对路径和内容进行相关性评分
  -> TokenBudget 截断并组装精选代码片段
  -> ModelAgent 发起流式模型请求
  -> Tool Call 增量聚合
  -> ToolRegistry 参数校验
  -> Workspace 安全检查
  -> list_files / read_file / search_code
  -> Tool Result 返回模型
  -> 最终分析结果流式输出
```

## 当前模块

```text
src/
├─ cli.ts
├─ agent/
│  ├─ agent-state.ts
│  ├─ create-agent.ts
│  ├─ task-planner.ts
│  ├─ model-agent.ts
│  └─ mock-agent.ts
├─ context/
│  ├─ context-selector.ts
│  ├─ ignore-rules.ts
│  ├─ project-scanner.ts
│  ├─ token-budget.ts
│  └─ workspace.ts
├─ models/
│  ├─ compatible-provider.ts
│  └─ config.ts
├─ tools/
│  ├─ create-read-only-tools.ts
│  ├─ registry.ts
│  ├─ types.ts
│  ├─ filesystem/
│  │  ├─ list-files.ts
│  │  └─ read-file.ts
│  └─ search/
│     └─ search-code.ts
├─ ui/
└─ commands/
```

## 模块职责

- CLI 只负责交互、斜杠命令和事件展示。
- AgentStateStore 保存最近一次计划、项目扫描和上下文摘要。
- TaskPlanner 建立可追踪的任务步骤，不操作文件。
- ProjectScanner 识别项目元数据并遵守忽略规则。
- ContextSelector 根据任务筛选文件，TokenBudget 控制发送规模。
- ModelAgent 负责 Agent Loop 和停止条件，不依赖具体模型厂商。
- ModelProvider 只处理模型服务协议。
- ToolRegistry 负责工具查找、参数校验和结果截断。
- Workspace 负责路径边界和真实路径检查。
- 当前 Tool Runtime 全部为只读工具。

## 上下文策略

1. 扫描最多 2500 个安全文件，最多 12 层目录。
2. 忽略依赖、构建、Git、本地会话、敏感配置和二进制文件。
3. 使用任务关键词、别名、路径、关键配置和内容匹配进行评分。
4. 最多检查 300 个候选文本文件，单文件最大 256 KB。
5. 最多选择 12 个文件，优先将预算分配给前 4 个相关文件，单文件片段最多约 1600 Tokens。
6. 初始上下文默认预算为 6000 Tokens，可通过环境变量调整。
7. 模型仍可通过只读工具获取预选范围之外的必要证据。

Token 数量为本地近似估算，用于控制代码片段规模，不等同于模型厂商的精确计费数字。

## 安全规则

- 模型输出不等于可执行操作。
- 项目代码片段按不可信数据处理，不能覆盖系统规则。
- 所有工具路径必须为工作区相对路径。
- 规范路径和真实路径都必须位于工作区。
- 忽略依赖、构建、Git、本地会话和敏感文件。
- 拒绝二进制和超大文本文件。
- 单任务最多 12 轮模型请求。
- 当前版本没有写文件、Shell 或 Git 写权限。

完整规划见 [project-guide.md](project-guide.md)。
