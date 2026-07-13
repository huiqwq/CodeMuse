import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelAgent } from "../src/agent/model-agent.ts";
import { openWorkspace } from "../src/context/workspace.ts";
import {
  buildSafeScriptEnvironment,
  type ScriptProcessRequest,
  type ScriptProcessResult,
} from "../src/tools/scripts/process-runner.ts";
import { ListScriptsTool } from "../src/tools/scripts/list-scripts.ts";
import { RunScriptTool } from "../src/tools/scripts/run-script.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import type { WorkspaceContext } from "../src/context/workspace.ts";
import type {
  ChatMessage,
  ModelProvider,
  ModelStreamEvent,
  ToolDefinition,
} from "../src/types.ts";

const signal = new AbortController().signal;

test("list_scripts 标记允许的验证脚本", async () => {
  await withPackage({
    test: "node tests.js",
    "test:unit": "node unit.js",
    build: "node build.js",
    "format:check": "prettier --check .",
    dev: "vite",
    pretest: "node prepare.js",
    deploy: "node deploy.js",
  }, async ({ workspace, registry }) => {
    registry.beginTask(workspace, "查看脚本");
    const result = await listScripts(registry, workspace);
    registry.finishTask();

    const scripts = (result.value as {
      scripts: Array<{ name: string; allowed: boolean }>;
    }).scripts;
    const allowed = scripts.filter((script) => script.allowed).map((script) => script.name);
    assert.deepEqual(allowed, ["build", "format:check", "test", "test:unit"]);
  });
});

test("没有 package.json 时明确拒绝脚本功能", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemuse-no-package-"));
  try {
    const workspace = await openWorkspace(root);
    const registry = createScriptRegistry(async () => successfulResult());
    registry.beginTask(workspace, "无 package");
    await assert.rejects(
      listScripts(registry, workspace),
      /根目录没有 package\.json/,
    );
    registry.finishTask();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run_script 必须先 list_scripts 且拒绝非验证脚本", async () => {
  await withPackage({
    test: "node tests.js",
    dev: "vite",
  }, async ({ workspace, registry }) => {
    registry.beginTask(workspace, "执行边界");
    await assert.rejects(
      runScript(registry, workspace, "test", async () => "approved"),
      /必须先.*list_scripts/,
    );

    await listScripts(registry, workspace);
    await assert.rejects(
      runScript(registry, workspace, "dev", async () => "approved"),
      /不在允许范围/,
    );
    registry.finishTask();
  });
});

test("run_script 默认拒绝且不会启动进程", async () => {
  let runnerCalls = 0;
  await withPackage({ test: "node tests.js" }, async ({ workspace, registry }) => {
    registry.beginTask(workspace, "默认拒绝");
    await listScripts(registry, workspace);

    const result = await registry.execute(
      scriptCall("test"),
      workspace,
      signal,
    );
    registry.finishTask();

    assert.equal((result.value as { executed: boolean }).executed, false);
    assert.equal(runnerCalls, 0);
  }, async () => {
    runnerCalls += 1;
    return successfulResult();
  });
});

test("用户确认后使用固定 npm 参数并返回输出和退出码", async () => {
  let captured: ScriptProcessRequest | null = null;
  const runner = async (request: ScriptProcessRequest): Promise<ScriptProcessResult> => {
    captured = request;
    return {
      exitCode: 2,
      stdout: "tests started\n",
      stderr: "1 test failed\n",
      timedOut: false,
      outputTruncated: false,
      durationMs: 123,
    };
  };

  await withPackage({ test: "node tests.js" }, async ({ workspace, registry }) => {
    registry.beginTask(workspace, "运行测试");
    await listScripts(registry, workspace);

    let approvalDetails = "";
    const result = await runScript(
      registry,
      workspace,
      "test",
      async (request) => {
        assert.equal(request.kind, "execute");
        approvalDetails = request.diff;
        return "approved";
      },
    );
    registry.finishTask();

    const value = result.value as {
      executed: boolean;
      success: boolean;
      exitCode: number | null;
    };
    assert.equal(value.executed, true);
    assert.equal(value.success, false);
    assert.equal(value.exitCode, 2);
    assert.match(approvalDetails, /node tests\.js/);
    assert.ok(captured);
    assert.equal(captured.cwd, workspace.root);
    assert.deepEqual(captured.args.slice(-3), ["run", "test", "--ignore-scripts"]);
    if (process.platform === "win32") {
      assert.equal(captured.command, process.execPath);
      assert.match(captured.args[0] ?? "", /npm-cli\.js$/);
    }
    assert.equal(captured.env.npm_config_ignore_scripts, "true");
    assert.match(result.displayContent ?? "", /1 test failed/);
  }, runner);
});

test("run_script 如实返回超时和输出截断状态", async () => {
  await withPackage(
    { build: "node build.js" },
    async ({ workspace, registry }) => {
      registry.beginTask(workspace, "构建超时");
      await listScripts(registry, workspace);
      const result = await runScript(
        registry,
        workspace,
        "build",
        async () => "approved",
      );
      registry.finishTask();

      const value = result.value as {
        success: boolean;
        timedOut: boolean;
        outputTruncated: boolean;
      };
      assert.equal(value.success, false);
      assert.equal(value.timedOut, true);
      assert.equal(value.outputTruncated, true);
      assert.match(result.summary, /超时/);
      assert.match(result.displayContent ?? "", /输出已截断/);
    },
    async () => ({
      exitCode: null,
      stdout: "",
      stderr: "...输出已截断",
      timedOut: true,
      outputTruncated: true,
      durationMs: 5_000,
    }),
  );
});
test("敏感环境变量不会传给项目脚本", () => {
  const environment = buildSafeScriptEnvironment({
    PATH: "safe",
    CODEMUSE_API_KEY: "secret",
    OPENAI_API_KEY: "secret",
    GITHUB_TOKEN: "secret",
    DATABASE_PASSWORD: "secret",
    AWS_SECRET_ACCESS_KEY: "secret",
    NODE_ENV: "test",
  });

  assert.equal(environment.PATH, "safe");
  assert.equal(environment.NODE_ENV, "test");
  assert.equal(environment.npm_config_ignore_scripts, "true");
  assert.equal(environment.CODEMUSE_API_KEY, undefined);
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.GITHUB_TOKEN, undefined);
  assert.equal(environment.DATABASE_PASSWORD, undefined);
  assert.equal(environment.AWS_SECRET_ACCESS_KEY, undefined);
});

class ScriptProvider implements ModelProvider {
  readonly name = "fake/script-model";
  calls = 0;

  async *stream(
    _messages: ChatMessage[],
    tools: ToolDefinition[],
    _signal: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent> {
    this.calls += 1;
    assert.equal(tools.length, 2);

    if (this.calls === 1) {
      yield {
        type: "tool-call-delta",
        index: 0,
        id: "list",
        name: "list_scripts",
        arguments: "{}",
      };
      return;
    }
    if (this.calls === 2) {
      yield {
        type: "tool-call-delta",
        index: 0,
        id: "run",
        name: "run_script",
        arguments: JSON.stringify({ script: "test" }),
      };
      return;
    }
    yield { type: "text-delta", content: "测试脚本执行完成。" };
  }
}

test("ModelAgent 完成脚本发现、授权执行和输出展示", async () => {
  await withPackage(
    { test: "node tests.js" },
    async ({ workspace, registry }) => {
      const provider = new ScriptProvider();
      const agent = new ModelAgent(provider, registry, 500);
      const events = [];
      let approvals = 0;

      for await (const event of agent.run("运行项目测试", {
        signal,
        workspace: workspace.root,
        requestApproval: async (request) => {
          approvals += 1;
          assert.equal(request.kind, "execute");
          return "approved";
        },
      })) {
        events.push(event);
      }

      assert.equal(provider.calls, 3);
      assert.equal(approvals, 1);
      assert.ok(
        events.some((event) =>
          event.type === "command-output" && event.content.includes("ok")
        ),
      );
      assert.ok(events.some((event) => event.type === "complete"));
    },
    async () => successfulResult(),
  );
});
type ScriptFixture = {
  workspace: WorkspaceContext;
  registry: ToolRegistry;
};

async function withPackage(
  scripts: Record<string, string>,
  run: (fixture: ScriptFixture) => Promise<void>,
  runner: (request: ScriptProcessRequest) => Promise<ScriptProcessResult> =
    async () => successfulResult(),
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "codemuse-scripts-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "script-fixture", scripts }, null, 2),
      "utf8",
    );
    const workspace = await openWorkspace(root);
    const registry = createScriptRegistry(runner);
    await run({ workspace, registry });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function createScriptRegistry(
  runner: (request: ScriptProcessRequest) => Promise<ScriptProcessResult>,
): ToolRegistry {
  return new ToolRegistry()
    .register(new ListScriptsTool())
    .register(new RunScriptTool(runner));
}

function listScripts(registry: ToolRegistry, workspace: WorkspaceContext) {
  return registry.execute(
    { id: "scripts", name: "list_scripts", arguments: "{}" },
    workspace,
    signal,
  );
}

function runScript(
  registry: ToolRegistry,
  workspace: WorkspaceContext,
  script: string,
  requestApproval: NonNullable<
    Parameters<ToolRegistry["execute"]>[3]
  >["requestApproval"],
) {
  return registry.execute(
    scriptCall(script),
    workspace,
    signal,
    { requestApproval },
  );
}

function scriptCall(script: string) {
  return {
    id: "run",
    name: "run_script",
    arguments: JSON.stringify({ script, timeoutMs: 5_000 }),
  };
}

function successfulResult(): ScriptProcessResult {
  return {
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
    timedOut: false,
    outputTruncated: false,
    durationMs: 10,
  };
}
