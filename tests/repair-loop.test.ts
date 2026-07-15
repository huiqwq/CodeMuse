import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { diagnoseScriptFailure } from "../src/agent/failure-diagnostics.ts";
import { ModelAgent } from "../src/agent/model-agent.ts";
import { RepairPolicy } from "../src/agent/repair-policy.ts";
import { createReadOnlyToolRegistry } from "../src/tools/create-read-only-tools.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { ApplyPatchTool } from "../src/tools/patch/apply-patch.ts";
import { ListScriptsTool } from "../src/tools/scripts/list-scripts.ts";
import {
  type ScriptProcessResult,
  type ScriptProcessRunner,
} from "../src/tools/scripts/process-runner.ts";
import {
  RunScriptTool,
  type RunScriptOutput,
} from "../src/tools/scripts/run-script.ts";
import type {
  ChatMessage,
  ModelProvider,
  ModelStreamEvent,
  ToolDefinition,
} from "../src/types.ts";

const signal = new AbortController().signal;

test("失败诊断提取 TypeScript 位置并生成稳定指纹", () => {
  const root = join(tmpdir(), "codemuse-diagnostic");
  const first = failedScript({
    stderr: "src/example.ts:12:7 - error TS2322: Type 'number' is not assignable to type 'string'.\nFinished in 18ms",
  });
  const second = failedScript({
    stderr: "src/example.ts:30:2 - error TS2322: Type 'number' is not assignable to type 'string'.\nFinished in 42ms",
  });

  const firstDiagnostic = diagnoseScriptFailure(first, root);
  const secondDiagnostic = diagnoseScriptFailure(second, root);

  assert.ok(firstDiagnostic);
  assert.ok(secondDiagnostic);
  assert.equal(firstDiagnostic.category, "typecheck");
  assert.deepEqual(firstDiagnostic.locations, [{
    path: "src/example.ts",
    line: 12,
    column: 7,
  }]);
  assert.equal(firstDiagnostic.fingerprint, secondDiagnostic.fingerprint);
  assert.match(firstDiagnostic.headline, /TS2322/);

  const outsidePath = join(root, "..", "outside.ts");
  const outsideDiagnostic = diagnoseScriptFailure(failedScript({
    stderr: `${outsidePath}:1:1 - error TS2322: outside workspace`,
  }), root);
  assert.ok(outsideDiagnostic);
  assert.deepEqual(outsideDiagnostic.locations, []);
});

test("修复策略限制三个补丁并识别重复失败", () => {
  const policy = new RepairPolicy(process.cwd());
  const failure = failedScript({
    stderr: "src/example.ts:1:1 - error TS2322: broken",
  });
  const first = policy.observe("run_script", failure);
  assert.match(first.notice ?? "", /已诊断/);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assert.equal(policy.beforeTool("apply_patch"), null);
    const observation = policy.observe("apply_patch", {
      path: "src/example.ts",
      applied: true,
      diff: "",
      message: "ok",
    });
    assert.match(observation.notice ?? "", new RegExp(`第 ${attempt}/3`));
  }
  assert.match(policy.beforeTool("apply_patch") ?? "", /3 个修复补丁上限/);

  const repeatedPolicy = new RepairPolicy(process.cwd());
  repeatedPolicy.observe("run_script", failure);
  const repeated = repeatedPolicy.observe("run_script", failure);
  assert.match(repeated.stoppedReason ?? "", /连续出现相同失败/);
});

class SuccessfulRepairProvider implements ModelProvider {
  readonly name = "fake/repair-model";
  calls = 0;
  receivedMessages: ChatMessage[][] = [];

  async *stream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    _signal: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent> {
    this.calls += 1;
    this.receivedMessages.push(structuredClone(messages));
    assert.equal(tools.length, 6);

    const calls = [
      { id: "list", name: "list_scripts", arguments: "{}" },
      { id: "fail", name: "run_script", arguments: '{"script":"typecheck"}' },
      { id: "read", name: "read_file", arguments: '{"path":"src/example.ts"}' },
      {
        id: "patch",
        name: "apply_patch",
        arguments: JSON.stringify({
          path: "src/example.ts",
          oldText: "const value: string = 1;",
          newText: 'const value: string = "1";',
        }),
      },
      { id: "verify", name: "run_script", arguments: '{"script":"typecheck"}' },
    ];

    const call = calls[this.calls - 1];
    if (call) {
      if (this.calls === 3) {
        const lastToolMessage = [...messages].reverse().find((message) =>
          message.role === "tool"
        );
        assert.match(lastToolMessage?.content ?? "", /CodeMuse 自动修复诊断/);
        assert.match(lastToolMessage?.content ?? "", /src\/example\.ts/);
      }
      yield {
        type: "tool-call-delta",
        index: 0,
        ...call,
      };
      return;
    }

    yield {
      type: "text-delta",
      content: "已修复类型错误，typecheck 退出码为 0。",
    };
  }
}

test("ModelAgent 完成失败诊断、补丁和复测成功闭环", async () => {
  const root = await createRepairWorkspace();
  let runs = 0;
  const runner: ScriptProcessRunner = async () => {
    runs += 1;
    return runs === 1
      ? {
          exitCode: 2,
          stdout: "",
          stderr: "src/example.ts:1:7 - error TS2322: Type 'number' is not assignable to type 'string'.\n",
          timedOut: false,
          outputTruncated: false,
          durationMs: 20,
        }
      : successfulProcess();
  };

  try {
    const provider = new SuccessfulRepairProvider();
    const agent = new ModelAgent(provider, createRepairRegistry(runner), 500);
    const events = [];
    let approvals = 0;

    for await (const event of agent.run("修复类型错误并运行 typecheck 验证", {
      signal,
      workspace: root,
      requestApproval: async () => {
        approvals += 1;
        return "approved";
      },
    })) {
      events.push(event);
    }

    assert.equal(provider.calls, 6);
    assert.equal(runs, 2);
    assert.equal(approvals, 3);
    assert.match(await readFile(join(root, "src", "example.ts"), "utf8"), /"1"/);
    assert.ok(events.some((event) =>
      event.type === "notice" && event.message.includes("已诊断 typecheck 失败")
    ));
    assert.ok(events.some((event) =>
      event.type === "notice" && event.message.includes("自动修复闭环完成")
    ));
    assert.ok(events.some((event) => event.type === "complete"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class RepeatedFailureProvider implements ModelProvider {
  readonly name = "fake/repeated-failure";
  calls = 0;

  async *stream(
    _messages: ChatMessage[],
    tools: ToolDefinition[],
    _signal: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent> {
    this.calls += 1;
    if (this.calls === 4) {
      assert.equal(tools.length, 0);
      yield {
        type: "text-delta",
        content: "相同错误重复出现，验证未通过，建议人工检查。",
      };
      return;
    }

    assert.equal(tools.length, 2);
    const call = this.calls === 1
      ? { id: "list", name: "list_scripts", arguments: "{}" }
      : {
          id: `run-${this.calls}`,
          name: "run_script",
          arguments: '{"script":"test"}',
        };
    yield { type: "tool-call-delta", index: 0, ...call };
  }
}

test("ModelAgent 在相同失败第二次出现后停止工具调用", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemuse-repeat-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "repeat", scripts: { test: "node test.js" } }),
      "utf8",
    );
    const registry = createScriptRegistry(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "src/example.ts:1:1 - error: same failure\n",
      timedOut: false,
      outputTruncated: false,
      durationMs: 10,
    }));
    const provider = new RepeatedFailureProvider();
    const agent = new ModelAgent(provider, registry, 500);
    const events = [];

    for await (const event of agent.run("运行测试并修复错误", {
      signal,
      workspace: root,
      requestApproval: async () => "approved",
    })) {
      events.push(event);
    }

    assert.equal(provider.calls, 4);
    assert.ok(events.some((event) =>
      event.type === "notice" && event.message.includes("连续出现相同失败")
    ));
    assert.ok(events.some((event) =>
      event.type === "complete" &&
      event.summary?.includes("自动修复已停止")
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function createRepairRegistry(runner: ScriptProcessRunner) {
  return createReadOnlyToolRegistry()
    .register(new ApplyPatchTool())
    .register(new ListScriptsTool())
    .register(new RunScriptTool(runner));
}

function createScriptRegistry(runner: ScriptProcessRunner) {
  return new ToolRegistry()
    .register(new ListScriptsTool())
    .register(new RunScriptTool(runner));
}

async function createRepairWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codemuse-repair-"));
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "repair-fixture",
      scripts: { typecheck: "tsc --noEmit" },
    }, null, 2),
    "utf8",
  );
  await writeFile(
    join(root, "src", "example.ts"),
    "const value: string = 1;\nexport { value };\n",
    "utf8",
  );
  return root;
}

function failedScript(overrides: Partial<RunScriptOutput>): RunScriptOutput {
  return {
    script: "typecheck",
    command: "npm run typecheck --ignore-scripts",
    scriptBody: "tsc --noEmit",
    executed: true,
    success: false,
    exitCode: 2,
    stdout: "",
    stderr: "",
    timedOut: false,
    outputTruncated: false,
    durationMs: 10,
    message: "脚本执行失败",
    ...overrides,
  };
}

function successfulProcess(): ScriptProcessResult {
  return {
    exitCode: 0,
    stdout: "typecheck passed\n",
    stderr: "",
    timedOut: false,
    outputTruncated: false,
    durationMs: 12,
  };
}
