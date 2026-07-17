import assert from "node:assert/strict";
import test from "node:test";
import { parseSlashCommand } from "../src/commands/slash-command.ts";

test("普通输入不是斜杠命令", () => {
  assert.equal(parseSlashCommand("修复登录接口"), null);
});

test("解析已知命令时忽略大小写和空格", () => {
  assert.deepEqual(parseSlashCommand("  /HELP  "), { name: "help" });
});

test("解析规划、上下文、扫描、撤销和会话命令", () => {
  assert.deepEqual(parseSlashCommand("/PLAN"), {
    name: "plan",
    action: "status",
  });
  assert.deepEqual(parseSlashCommand("/plan on"), {
    name: "plan",
    action: "on",
  });
  assert.deepEqual(parseSlashCommand("/plan revise 缩小修改范围"), {
    name: "plan",
    action: "revise",
    value: "缩小修改范围",
  });
  assert.deepEqual(parseSlashCommand("/goal create 修复登录"), {
    name: "goal",
    action: "create",
    value: "修复登录",
  });
  assert.deepEqual(parseSlashCommand("/memory add 使用严格模式"), {
    name: "memory",
    action: "add",
    value: "使用严格模式",
  });
  assert.deepEqual(parseSlashCommand("/approval plan-scoped"), {
    name: "approval",
    mode: "plan-scoped",
  });
  assert.deepEqual(parseSlashCommand("/doctor export"), {
    name: "doctor",
    action: "export",
  });
  assert.deepEqual(parseSlashCommand("/context"), { name: "context" });
  assert.deepEqual(parseSlashCommand("/scan"), { name: "scan" });
  assert.deepEqual(parseSlashCommand("/undo"), { name: "undo" });
  assert.deepEqual(parseSlashCommand("/history"), { name: "history" });
  assert.deepEqual(parseSlashCommand("/usage"), { name: "usage" });
  assert.deepEqual(parseSlashCommand("/model"), {
    name: "model",
    action: "show",
  });
  assert.deepEqual(parseSlashCommand("/model list"), {
    name: "model",
    action: "list",
  });
  assert.deepEqual(parseSlashCommand("/model use glm"), {
    name: "model",
    action: "use",
    value: "glm",
  });
  assert.deepEqual(parseSlashCommand("/model test"), {
    name: "model",
    action: "test",
  });
  assert.deepEqual(parseSlashCommand("/model test deepseek"), {
    name: "model",
    action: "test",
    value: "deepseek",
  });
  assert.deepEqual(parseSlashCommand("/review"), {
    name: "review",
    mode: "report",
  });
  assert.deepEqual(parseSlashCommand("/review --fix src/app.ts"), {
    name: "review",
    mode: "fix",
    target: "src/app.ts",
  });
  assert.deepEqual(parseSlashCommand("/paste"), { name: "paste" });
  assert.deepEqual(parseSlashCommand("/resume"), { name: "resume" });
  assert.deepEqual(parseSlashCommand("/resume 1234abcd"), {
    name: "resume",
    id: "1234abcd",
  });
});

test("保留未知命令名称", () => {
  assert.deepEqual(parseSlashCommand("/missing now"), {
    name: "unknown",
    value: "missing",
  });
});
