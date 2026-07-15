import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openWorkspace } from "../src/context/workspace.ts";
import { CreateFileTool } from "../src/tools/filesystem/create-file.ts";
import { ReadFileTool } from "../src/tools/filesystem/read-file.ts";
import { ApplyPatchTool } from "../src/tools/patch/apply-patch.ts";
import { GitDiffTool } from "../src/tools/git/git-diff.ts";
import {
  GitStatusTool,
  parsePorcelainStatus,
  type GitStatusSnapshot,
} from "../src/tools/git/git-status.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import type {
  GitProcessRequest,
  GitProcessResult,
} from "../src/tools/git/process-runner.ts";
import type { WorkspaceContext } from "../src/context/workspace.ts";

const signal = new AbortController().signal;

test("解析 Git Porcelain 分支、普通变更和重命名路径", () => {
  const parsed = parsePorcelainStatus(
    "## main...origin/main\0 M src/index.ts\0R  src/new.ts\0src/old.ts\0",
  );
  assert.equal(parsed.branch, "main");
  assert.deepEqual(parsed.entries, [
    { code: " M", path: "src/index.ts" },
    {
      code: "R ",
      path: "src/new.ts",
      originalPath: "src/old.ts",
    },
  ]);
});

test("Git Status 区分任务前已有改动、本次 Agent 改动和共同改动", async () => {
  const root = await createWorkspace();
  try {
    const workspace = await openWorkspace(root);
    const baseline: GitStatusSnapshot = {
      isRepository: true,
      branch: "main",
      entries: [
        { code: " M", path: "src/shared.ts" },
        { code: " M", path: "src/user.ts" },
      ],
      outputTruncated: false,
      message: "baseline",
    };
    let repositoryDiffArgs: string[] = [];
    const runner = async (request: GitProcessRequest): Promise<GitProcessResult> => {
      if (request.args[0] === "status") {
        return gitResult({
          stdout: [
            "## main...origin/main",
            " M src/shared.ts",
            " M src/user.ts",
            "?? src/agent.ts",
            " M .env",
            "",
          ].join("\0"),
        });
      }
      repositoryDiffArgs = request.args;
      return gitResult({
        stdout: [
          "diff --git a/src/shared.ts b/src/shared.ts",
          "-export const shared = 1;",
          "+export const shared = 3;",
          "",
        ].join("\n"),
      });
    };
    const registry = new ToolRegistry(async () => baseline)
      .register(new ReadFileTool())
      .register(new ApplyPatchTool())
      .register(new CreateFileTool())
      .register(new GitStatusTool(runner))
      .register(new GitDiffTool(runner));

    registry.beginTask(workspace, "修改并审查 Git");
    await execute(registry, workspace, "read_file", { path: "src/shared.ts" });
    await execute(
      registry,
      workspace,
      "apply_patch",
      {
        path: "src/shared.ts",
        oldText: "shared = 2",
        newText: "shared = 3",
      },
      async () => "approved",
    );
    await execute(
      registry,
      workspace,
      "create_file",
      {
        path: "src/agent.ts",
        content: "export const agent = true;\n",
      },
      async () => "approved",
    );

    const statusResult = await execute(
      registry,
      workspace,
      "git_status",
      {},
    );
    const status = statusResult.value as {
      isRepository: boolean;
      branch: string | null;
      entries: Array<{ path: string; origin: string }>;
    };
    assert.equal(status.isRepository, true);
    assert.equal(status.branch, "main");
    assert.equal(
      status.entries.find((entry) => entry.path === "src/shared.ts")?.origin,
      "user-and-agent",
    );
    assert.equal(
      status.entries.find((entry) => entry.path === "src/user.ts")?.origin,
      "user-existing",
    );
    assert.equal(
      status.entries.find((entry) => entry.path === "src/agent.ts")?.origin,
      "agent",
    );
    assert.match(statusResult.displayContent ?? "", /任务前已有 \+ Agent/);

    assert.equal(
      status.entries.some((entry) => entry.path === ".env"),
      false,
    );

    const diffResult = await execute(
      registry,
      workspace,
      "git_diff",
      {},
    );
    assert.match((diffResult.value as { diff: string }).diff, /shared = 3/);
    assert.ok(repositoryDiffArgs.includes(":(exclude).env"));
    assert.ok(repositoryDiffArgs.includes(":(exclude).codemuse/**"));
    registry.finishTask();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("非 Git 工作区返回明确只读结果", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemuse-no-git-"));
  try {
    const workspace = await openWorkspace(root);
    const notRepository: GitStatusSnapshot = {
      isRepository: false,
      branch: null,
      entries: [],
      outputTruncated: false,
      message: "当前工作区不是 Git 仓库",
    };
    const runner = async (): Promise<GitProcessResult> => gitResult({
      exitCode: 128,
      stderr: "fatal: not a git repository",
    });
    const registry = new ToolRegistry(async () => notRepository)
      .register(new GitStatusTool(runner))
      .register(new GitDiffTool(runner));
    registry.beginTask(workspace, "查看状态");

    const status = await execute(registry, workspace, "git_status", {});
    const diff = await execute(registry, workspace, "git_diff", {});
    assert.equal((status.value as { isRepository: boolean }).isRepository, false);
    assert.equal((diff.value as { isRepository: boolean }).isRepository, false);
    registry.finishTask();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Git Diff 如实处理超时和输出截断", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemuse-git-runner-"));
  try {
    const workspace = await openWorkspace(root);
    const timeoutRegistry = new ToolRegistry().register(
      new GitDiffTool(async () => gitResult({ timedOut: true })),
    );
    timeoutRegistry.beginTask(workspace, "Git 超时");
    await assert.rejects(
      execute(timeoutRegistry, workspace, "git_diff", {}),
      /执行超时/,
    );
    timeoutRegistry.finishTask();

    const truncatedRegistry = new ToolRegistry().register(
      new GitDiffTool(async () => gitResult({
        stdout: "diff --git a/a.ts b/a.ts\n",
        outputTruncated: true,
      })),
    );
    truncatedRegistry.beginTask(workspace, "Git 截断");
    const result = await execute(
      truncatedRegistry,
      workspace,
      "git_diff",
      {},
    );
    assert.equal(
      (result.value as { outputTruncated: boolean }).outputTruncated,
      true,
    );
    assert.match(result.displayContent ?? "", /已截断/);
    truncatedRegistry.finishTask();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codemuse-git-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "shared.ts"), "export const shared = 2;\n");
  await writeFile(join(root, "src", "user.ts"), "export const user = 2;\n");
  return root;
}

function execute(
  registry: ToolRegistry,
  workspace: WorkspaceContext,
  name: string,
  input: unknown,
  requestApproval?: NonNullable<
    Parameters<ToolRegistry["execute"]>[3]
  >["requestApproval"],
) {
  return registry.execute(
    {
      id: `${name}-call`,
      name,
      arguments: JSON.stringify(input),
    },
    workspace,
    signal,
    requestApproval ? { requestApproval } : {},
  );
}

function gitResult(
  overrides: Partial<GitProcessResult>,
): GitProcessResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    outputTruncated: false,
    durationMs: 10,
    ...overrides,
  };
}
