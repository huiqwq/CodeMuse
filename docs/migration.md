# v0.10.0 到 v1.0.0 迁移

1. 保留现有 `.codemuse/sessions/`、`~/.codemuse/config.json` 和凭据文件。
2. 安装 v1.0.0 后先运行 `/doctor`。
3. 原 `/plan` 查看命令等价于 `/plan status`。
4. 新增的 `plan.json`、`goals.json`、`memory.json` 和 `settings.json` 会在首次使用时创建。
5. 默认授权仍为 `strict`；只有显式执行 `/approval plan-scoped` 才启用计划范围自治。

v1.0.0 继续读取会话 schema 1，不重放旧会话中的写入或授权。任何损坏或未知 schema 数据都会被拒绝，不会覆盖原文件。
