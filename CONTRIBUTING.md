# 参与开发

## 分支

不要直接在 `main` 开发。每项任务创建独立分支：

```text
feat/terminal-ui
feat/model-provider
feat/read-file-tool
fix/cancel-task
docs/architecture
```

## 提交信息

```text
feat: add interactive terminal
fix: stop task after cancellation
test: add model config tests
docs: describe agent architecture
chore: update project config
```

## 提交前检查

```powershell
node --test tests/slash-command.test.ts tests/model-config.test.ts
node --check src/cli.ts
```

真实 API Key 不得提交。每个人使用自己的 GitHub 账号和 Git 身份，通过 Pull Request 合并到 `main`。
