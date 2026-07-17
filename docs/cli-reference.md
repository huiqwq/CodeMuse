# CodeMuse CLI 命令参考

## 启动与模型

```text
codemuse [WORKSPACE]
codemuse auth login|status|logout [PROFILE]
/model list|use|test|init|reload
/usage
/doctor [export]
```

## 任务工作流

```text
/plan on|status|revise|approve|off
/goal create|status|pause|resume|complete|cancel|history
/memory list|show|add|forget|clear
/approval strict|plan-scoped
```

普通自然语言在 Plan Mode 中只读规划；Goal 为 active 时作为该 Goal 的当前子任务；其他情况下按普通 Agent 任务执行。

## 项目与恢复

```text
/review [PATH]
/review --fix [PATH]
/paste
/scan
/context
/history
/resume [ID]
/undo
/clear
/cancel
/exit
```

`strict` 是默认授权模式。`plan-scoped` 只对已批准计划范围内的普通写入和验证命令自动授权，删除和重命名仍需确认。
