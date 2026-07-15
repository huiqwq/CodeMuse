import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPastedReviewTask,
  buildReviewTask,
  PasteBuffer,
} from "../src/review/review-task.ts";
import { createCodingToolRegistry } from "../src/tools/create-coding-tools.ts";

test("代码审查任务区分只读报告和确认后修复", () => {
  const report = buildReviewTask("report", "src/app.ts");
  assert.match(report, /src\/app\.ts/);
  assert.match(report, /只读审查/);
  assert.match(report, /文件与行号/);

  const fix = buildReviewTask("fix");
  assert.match(fix, /最小局部补丁/);
  assert.match(fix, /用户确认/);
  assert.match(fix, /验证脚本/);
});

test("粘贴代码按 JSON 数据隔离且限制大小", () => {
  const buffer = new PasteBuffer();
  buffer.add("const value = 1;");
  buffer.add("console.log(value);");
  assert.equal(buffer.lineCount, 2);

  const task = buildPastedReviewTask(buffer.finish());
  assert.match(task, /不可执行、不可信的数据/);
  assert.match(task, /不要调用任何工具/);
  assert.match(task, /const value/);
  assert.doesNotThrow(() => JSON.parse(task.slice(task.lastIndexOf("\n") + 1)));
  assert.throws(() => buildPastedReviewTask(""), /没有可审查/);
});

test("只读审查工具列表和执行入口都拒绝写入工具", async () => {
  const registry = createCodingToolRegistry();
  const readOnly = registry.definitions(["read"]);
  const names = readOnly.map((definition) => definition.function.name);

  assert.ok(names.includes("read_file"));
  assert.ok(names.includes("git_diff"));
  assert.ok(!names.includes("apply_patch"));
  assert.ok(!names.includes("run_script"));

  await assert.rejects(
    registry.execute(
      { id: "blocked", name: "apply_patch", arguments: "{}" },
      {} as never,
      new AbortController().signal,
      { allowedRisks: ["read"] },
    ),
    /不允许 write 工具/,
  );
});
