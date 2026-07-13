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

## 版本记录要求

每个正式版本必须同时更新：

1. `package.json` 中的版本号。
2. 根目录 `CHANGELOG.md`。
3. `docs/releases/v<版本号>.md` 独立版本文档。
4. `docs/releases/README.md` 版本索引。
5. README 的当前能力和路线图。

版本文档必须记录版本目标、完成内容、使用方法、测试结果、已知限制和下一版本计划。普通小修复提交不需要单独创建文档，但必须归入下一个版本的 CHANGELOG。