import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GoalStore } from "../src/goals/goal-store.ts";
import { ProjectMemoryStore } from "../src/memory/project-memory-store.ts";
import { PlanStore } from "../src/planning/plan-store.ts";
import { WorkspaceSettingsStore } from "../src/settings/workspace-settings.ts";
import { createCodingToolRegistry } from "../src/tools/create-coding-tools.ts";
import { openWorkspace } from "../src/context/workspace.ts";

test("PlanStore 保存结构化计划、修订并检测工作区漂移", async () => {
  const root = await createWorkspace("plan");
  try {
    const store = new PlanStore(root);
    const plan = await store.create(
      "修改入口值",
      {
        projectName: "plan",
        projectTypes: ["TypeScript"],
        languages: ["TypeScript"],
        frameworks: [],
        packageManager: "npm",
        fileCount: 2,
        files: ["package.json", "src/index.ts"],
        keyFiles: ["package.json"],
        truncated: false,
      },
      {
        budgetTokens: 500,
        estimatedTokens: 100,
        files: [{
          path: "src/index.ts",
          score: 10,
          estimatedTokens: 100,
          truncated: false,
        }],
        omittedFiles: 0,
        truncated: false,
      },
      "- 修改 `src/index.ts`\n- 运行测试",
    );

    assert.equal(plan.status, "ready");
    assert.ok(plan.scope.includes("src/index.ts"));
    assert.equal(await store.verifyFresh(plan), true);

    const revised = await store.revise(
      plan,
      "补充类型检查",
      null,
      null,
      "- 修改 `src/index.ts`\n- 执行 typecheck",
    );
    assert.equal(revised.revision, 2);
    assert.equal(revised.revisionNotes.at(-1), "补充类型检查");

    await writeFile(
      join(root, "src", "index.ts"),
      "export const value = 2;\n",
      "utf8",
    );
    assert.equal(await store.verifyFresh(revised), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GoalStore 持久化预算、证据并只保留一个活动目标", async () => {
  const root = await createWorkspace("goal");
  try {
    const store = new GoalStore(root);
    const goal = await store.create("实现入口功能");
    await assert.rejects(() => store.create("另一个目标"), /已有未结束目标/);

    const updated = await store.recordRun(goal, {
      summary: "修改完成；验证通过",
      totalTokens: 120,
      runtimeMs: 50,
      completed: true,
      verified: true,
      validationCommands: ["npm run test"],
    });
    assert.equal(updated.status, "completed");
    assert.equal(updated.budget.usedTokens, 120);
    assert.ok(updated.evidence.some((item) => item.includes("验证通过")));
    assert.equal(await store.active(), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("项目记忆按工作区保存、拒绝密钥并在关联文件变化后失效", async () => {
  const root = await createWorkspace("memory");
  try {
    const store = new ProjectMemoryStore(root);
    const memory = await store.add(
      "src/index.ts 使用不可变导出，这是用户确认的项目约定",
    );
    assert.equal(memory.stale, false);
    assert.deepEqual(memory.relatedPaths, ["src/index.ts"]);
    assert.ok((await store.retrieve("修改 index 导出")).length > 0);
    await assert.rejects(
      () => store.add("API_KEY=sk-secret-value-123456"),
      /敏感凭据/,
    );

    await writeFile(
      join(root, "src", "index.ts"),
      "export const value = 3;\n",
      "utf8",
    );
    const refreshed = await store.get(memory.id);
    assert.equal(refreshed.stale, true);
    assert.equal((await store.retrieve("修改 index 导出")).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("计划执行范围在 ToolRegistry 层拒绝越界且补丁校验读取指纹", async () => {
  const root = await createWorkspace("scope");
  try {
    const workspace = await openWorkspace(root);
    const registry = createCodingToolRegistry();
    registry.beginTask(workspace, "修改入口");
    const signal = new AbortController().signal;
    await registry.execute({
      id: "read",
      name: "read_file",
      arguments: JSON.stringify({ path: "src/index.ts" }),
    }, workspace, signal);

    await assert.rejects(
      () => registry.execute({
        id: "patch",
        name: "apply_patch",
        arguments: JSON.stringify({
          path: "src/index.ts",
          oldText: "value = 1",
          newText: "value = 2",
        }),
      }, workspace, signal, {
        allowedRisks: ["read", "write"],
        executionScope: ["src/other.ts"],
      }),
      /计划范围外/,
    );

    await writeFile(
      join(root, "src", "index.ts"),
      "export const value = 9;\n",
      "utf8",
    );
    await assert.rejects(
      () => registry.execute({
        id: "patch-stale",
        name: "apply_patch",
        arguments: JSON.stringify({
          path: "src/index.ts",
          oldText: "value = 9",
          newText: "value = 10",
        }),
      }, workspace, signal, {
        allowedRisks: ["read", "write"],
        executionScope: ["src/index.ts"],
      }),
      /读取后发生变化/,
    );
    registry.finishTask();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("工作区授权设置默认严格并可持久化计划范围模式", async () => {
  const root = await createWorkspace("settings");
  try {
    const store = new WorkspaceSettingsStore(root);
    assert.equal((await store.load()).approvalMode, "strict");
    await store.save({ approvalMode: "plan-scoped", logLevel: "info" });
    assert.deepEqual(await store.load(), {
      approvalMode: "plan-scoped",
      logLevel: "info",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("多文件补丁集一次确认并写入全部已读取文件", async () => {
  const root = await createWorkspace("patch-set");
  try {
    await writeFile(
      join(root, "src", "utils.ts"),
      "export const name = 'old';\n",
      "utf8",
    );
    const workspace = await openWorkspace(root);
    const registry = createCodingToolRegistry();
    registry.beginTask(workspace, "多文件修改");
    const signal = new AbortController().signal;
    for (const path of ["src/index.ts", "src/utils.ts"]) {
      await registry.execute({
        id: `read-${path}`,
        name: "read_file",
        arguments: JSON.stringify({ path }),
      }, workspace, signal);
    }
    let approvals = 0;
    const result = await registry.execute({
      id: "patch-set",
      name: "apply_patch_set",
      arguments: JSON.stringify({
        patches: [
          {
            path: "src/index.ts",
            oldText: "value = 1",
            newText: "value = 2",
          },
          {
            path: "src/utils.ts",
            oldText: "'old'",
            newText: "'new'",
          },
        ],
      }),
    }, workspace, signal, {
      allowedRisks: ["read", "write"],
      executionScope: ["src/index.ts", "src/utils.ts"],
      requestApproval: async () => {
        approvals += 1;
        return "approved";
      },
    });

    assert.equal(approvals, 1);
    assert.match(result.summary, /2 个文件/);
    assert.match(await readFile(join(root, "src", "index.ts"), "utf8"), /value = 2/);
    assert.match(await readFile(join(root, "src", "utils.ts"), "utf8"), /'new'/);
    registry.finishTask();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createWorkspace(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `codemuse-${name}-`));
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name,
      scripts: { test: "node --test", typecheck: "tsc --noEmit" },
    }),
    "utf8",
  );
  await writeFile(
    join(root, "src", "index.ts"),
    "export const value = 1;\n",
    "utf8",
  );
  return root;
}
