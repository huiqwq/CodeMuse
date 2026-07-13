# CodeMuse 架构

## v0.4.0 执行链路

```text
CLI 输入分析或修改任务
  -> ProjectScanner + TaskPlanner
  -> ContextSelector + TokenBudget
  -> ModelAgent
  -> ToolRegistry
       ├─ list_files / read_file / search_code
       └─ apply_patch
            -> 验证工作区与 UTF-8 文本
            -> 验证本任务已 read_file
            -> 验证 oldText 唯一且为局部片段
            -> 内存生成 Unified Diff
            -> CLI 等待用户 y/yes
            -> 再次检查文件未变化
            -> 同目录临时文件安全替换
            -> ChangeJournal 记录任务变更
  -> /undo 生成反向 Diff、确认并恢复
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
├─ changes/
│  ├─ atomic-write.ts
│  ├─ change-journal.ts
│  └─ diff.ts
├─ context/
│  ├─ context-selector.ts
│  ├─ ignore-rules.ts
│  ├─ project-scanner.ts
│  ├─ token-budget.ts
│  └─ workspace.ts
├─ models/
├─ tools/
│  ├─ create-coding-tools.ts
│  ├─ create-read-only-tools.ts
│  ├─ registry.ts
│  ├─ filesystem/
│  ├─ patch/
│  │  └─ apply-patch.ts
│  └─ search/
├─ ui/
└─ commands/
```

## 模块职责

- CLI 负责输入、展示、Diff 确认和斜杠命令，不直接写文件。
- ModelAgent 负责任务循环，将模型工具请求交给 ToolRegistry。
- ToolRegistry 负责工具查找、参数校验、读取记录和变更日志生命周期。
- Workspace 负责相对路径、真实路径、忽略规则和工作区边界。
- ApplyPatchTool 负责精确局部替换、并发校验和确认后写入。
- ChangeJournal 将同一任务对同一文件的多次修改合并为一条可撤销记录。
- AtomicWrite 使用目标目录中的临时文件替换原文件。
- ModelProvider 只处理模型服务协议，不能直接访问文件系统。

## 写入权限规则

1. 只修改已存在的普通 UTF-8 文本文件。
2. 文件必须位于工作区内，且不属于忽略或敏感路径。
3. 单文件最大 1 MB，单个补丁片段最大 50000 字符。
4. 模型必须在当前任务中先成功调用 `read_file`。
5. `oldText` 必须在文件中恰好出现一次。
6. 禁止整文件或仅省略末尾换行的整文件覆盖。
7. 修改前只生成内存 Diff，不提前写入。
8. 没有用户明确输入 `y` 或 `yes` 时默认拒绝。
9. 确认后再次读取文件；发生变化则拒绝覆盖。
10. 单任务最多记录 20 个修改文件。

## 撤销规则

- `/undo` 只针对当前进程内最近一次有写入的任务。
- 撤销前展示所有文件的反向 Diff 并再次请求确认。
- 文件当前内容必须与 CodeMuse 上次写入结果完全一致。
- 撤销确认后再次校验，防止确认期间发生并发变化。
- 多文件撤销失败时尽力恢复已经撤销的文件。
- 退出 CodeMuse 后变更日志消失；持久化会话属于后续版本。

## 上下文与终端安全

- 初始代码上下文继续受 Token 预算控制。
- 项目代码按不可信数据处理，不能覆盖系统提示。
- 模型输出和 Diff 中的终端控制字符会转换为可见文本。
- 当前版本不执行 Shell、Git 写操作，不创建或删除文件。

完整规划见 [project-guide.md](project-guide.md)。
