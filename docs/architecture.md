# CodeMuse 架构

## v0.2.0 执行链路

```text
CLI 输入
  -> ModelAgent
  -> ModelProvider 流式响应
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
│  ├─ create-agent.ts
│  ├─ model-agent.ts
│  └─ mock-agent.ts
├─ context/
│  ├─ ignore-rules.ts
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

## 边界

- CLI 只负责交互和事件展示。
- ModelAgent 负责 Agent Loop 和停止条件。
- ModelProvider 只处理模型厂商协议。
- ToolRegistry 负责工具查找、参数校验和结果截断。
- Workspace 负责路径边界和真实路径检查。
- 当前 Tool Runtime 全部为只读工具。

## 安全规则

- 模型输出不等于可执行操作。
- 所有路径必须为工作区相对路径。
- 规范路径和真实路径都必须位于工作区。
- 忽略依赖、构建、Git、本地会话和敏感文件。
- 拒绝二进制和超大文本文件。
- 单任务最多 12 轮模型请求。
- 当前版本没有写文件或 Shell 权限。

完整规划见 [project-guide.md](project-guide.md)。
