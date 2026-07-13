# 参与开发

## 当前协作方式

当前四人小组采用简单的直接提交 `main` 流程。提交前先确认远程没有更新，并确保工作区中的修改都属于本次版本。

```powershell
git switch main
git pull origin main
git status
```

开发完成并验证后：

```powershell
git add .
git status
git commit -m "feat: describe the feature"
git push origin main
```

多人不要同时修改同一个文件。开始开发前在小组中说明负责模块，推送前再次执行 `git pull origin main`；如果出现冲突，先解决冲突并重新运行测试。

## 提交信息

```text
feat: 新功能
fix: 修复缺陷
test: 测试
docs: 文档
refactor: 不改变行为的重构
chore: 配置和工具维护
```

## 提交前检查

以下 npm 命令必须在包含 CodeMuse `package.json` 的源码根目录执行。先运行 `Test-Path .\package.json`，结果应为 `True`。

```powershell
npm test
npm run typecheck
git status
```

真实 API Key、`.env`、`node_modules`、个人缓存和编辑器临时文件不得提交。

## 版本记录要求

每个正式版本必须同时更新：

1. `package.json` 和 `package-lock.json` 中的版本号。
2. 根目录 `CHANGELOG.md`。
3. `docs/releases/v<版本号>.md` 独立版本文档。
4. `docs/releases/README.md` 版本索引。
5. README 的当前能力和路线图。

版本文档必须记录版本目标、完成内容、使用方法、测试结果、已知限制和下一版本计划。普通小修复提交不需要单独创建文档，但必须归入下一个版本的 CHANGELOG。
