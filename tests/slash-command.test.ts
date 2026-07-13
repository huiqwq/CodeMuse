import assert from "node:assert/strict";
import test from "node:test";
import { parseSlashCommand } from "../src/commands/slash-command.ts";

test("普通输入不是斜杠命令", () => {
  assert.equal(parseSlashCommand("修复登录接口"), null);
});

test("解析已知命令时忽略大小写和空格", () => {
  assert.deepEqual(parseSlashCommand("  /HELP  "), { name: "help" });
});

test("解析规划、上下文和扫描命令", () => {
  assert.deepEqual(parseSlashCommand("/PLAN"), { name: "plan" });
  assert.deepEqual(parseSlashCommand("/context"), { name: "context" });
  assert.deepEqual(parseSlashCommand("/scan"), { name: "scan" });
});

test("保留未知命令名称", () => {
  assert.deepEqual(parseSlashCommand("/missing now"), {
    name: "unknown",
    value: "missing",
  });
});
