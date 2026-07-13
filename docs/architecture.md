# CodeMuse 架构

```text
CLI 输入与显示
      |
AgentRunner 统一事件流
      |
ModelAgent / MockAgent
      |
ModelProvider
      |
DeepSeek / GLM / 自定义兼容 API
```

`src/ui` 只负责终端显示，`src/agent` 负责执行过程，`src/models` 负责模型协议。未来接入 Ink 时只替换 UI 层；未来加入工具调用时扩展 Agent 层，不让模型直接访问文件系统。

## 安全原则

- 模型输出不等于可执行指令。
- 所有工具参数必须通过结构化校验。
- 文件访问必须限制在工作区根目录内。
- 写文件和高风险命令必须获得用户确认。
- API Key 只保存在本地环境或安全存储中。
- 日志中禁止记录完整 API Key。

## 下一阶段工具

- `list_files`：列出工作区文件并排除 `.git`、`node_modules`。
- `read_file`：按行读取文本文件，限制体积。
- `search_code`：搜索关键词、函数和错误信息。

工具接入后，Agent Loop 才形成真正的 `LLM -> Tool Call -> Tool Result -> LLM` 循环。
