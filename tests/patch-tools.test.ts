import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openWorkspace } from "../src/context/workspace.ts";
import { createCodingToolRegistry } from "../src/tools/create-coding-tools.ts";
import type { ToolRegistry } from "../src/tools/registry.ts";
import type { WorkspaceContext } from "../src/context/workspace.ts";

const signal = new AbortController().signal;

test("apply_patch 要求先读取文件并拒绝重复片段", async () => {
  await withFixture(
    "const repeated = true;\nconst repeated = true;\nexport {};\n",
    async ({ workspace, registry }) => {
      registry.beginTask(workspace, "测试精确匹配");
      await assert.rejects(
        applyPatch(registry, workspace, {
          oldText: "const repeated = true;",
          newText: "const repeated = false;",
        }, "approved"),
        /必须先.*read_file/,
      );

      await observeFile(registry, workspace);
      await assert.rejects(
        applyPatch(registry, workspace, {
          oldText: "const repeated = true;",
          newText: "const repeated = false;",
        }, "approved"),
        /出现 2 次/,
      );
      registry.finishTask();
    },
  );
});

test("apply_patch 拒绝以缺少末尾换行的方式覆盖整文件", async () => {
  const original = "const value = 1;\nexport { value };\n";
  await withFixture(original, async ({ workspace, registry }) => {
    registry.beginTask(workspace, "整文件保护");
    await observeFile(registry, workspace);
    await assert.rejects(
      applyPatch(registry, workspace, {
        oldText: original.trimEnd(),
        newText: "const replacement = true;",
      }, "approved"),
      /拒绝整文件覆盖/,
    );
    registry.finishTask();
  });
});
test("用户拒绝 Diff 后文件保持不变", async () => {
  const original = "const value = 1;\nexport { value };\n";
  await withFixture(original, async ({ path, workspace, registry }) => {
    registry.beginTask(workspace, "拒绝修改");
    await observeFile(registry, workspace);

    const defaultDenied = await registry.execute(
      patchCall("const value = 1;", "const value = 2;"),
      workspace,
      signal,
    );
    assert.equal((defaultDenied.value as { applied: boolean }).applied, false);
    assert.equal(await readFile(path, "utf8"), original);

    let shownDiff = "";
    const result = await registry.execute(
      patchCall("const value = 1;", "const value = 2;"),
      workspace,
      signal,
      {
        requestApproval: async (request) => {
          shownDiff = request.diff;
          return "denied";
        },
      },
    );
    registry.finishTask();

    assert.equal((result.value as { applied: boolean }).applied, false);
    assert.match(shownDiff, /-const value = 1;/);
    assert.match(shownDiff, /\+const value = 2;/);
    assert.equal(await readFile(path, "utf8"), original);
  });
});

test("确认后写入局部补丁并可通过任务级撤销恢复", async () => {
  const original =
    "const value = 1;\r\nexport const label = \"before\";\r\nexport { value };\r\n";
  await withFixture(original, async ({ path, workspace, registry }) => {
    registry.beginTask(workspace, "更新值和标签");
    await observeFile(registry, workspace);

    const result = await registry.execute(
      patchCall(
        "const value = 1;\nexport const label = \"before\";",
        "const value = 2;\nexport const label = \"after\";",
      ),
      workspace,
      signal,
      { requestApproval: async () => "approved" },
    );
    registry.finishTask();

    assert.equal((result.value as { applied: boolean }).applied, true);
    const updated = await readFile(path, "utf8");
    assert.match(updated, /value = 2/);
    assert.match(updated, /label = "after"/);
    assert.ok(updated.includes("\r\n"));

    const defaultUndo = await registry.undoLatest(workspace, signal);
    assert.equal(defaultUndo.undone, false);
    assert.match(await readFile(path, "utf8"), /value = 2/);

    let undoKind = "";
    const undo = await registry.undoLatest(
      workspace,
      signal,
      async (request) => {
        undoKind = request.kind;
        return "approved";
      },
    );

    assert.equal(undoKind, "undo");
    assert.equal(undo.undone, true);
    assert.deepEqual(undo.restoredFiles, ["src/example.ts"]);
    assert.equal(await readFile(path, "utf8"), original);
  });
});

test("文件在 Diff 确认期间变化时拒绝覆盖", async () => {
  const original = "const value = 1;\nexport { value };\n";
  await withFixture(original, async ({ path, workspace, registry }) => {
    registry.beginTask(workspace, "并发保护");
    await observeFile(registry, workspace);

    await assert.rejects(
      registry.execute(
        patchCall("const value = 1;", "const value = 2;"),
        workspace,
        signal,
        {
          requestApproval: async () => {
            await writeFile(path, "const external = true;\n", "utf8");
            return "approved";
          },
        },
      ),
      /确认期间发生变化/,
    );
    registry.finishTask();
    assert.equal(await readFile(path, "utf8"), "const external = true;\n");
  });
});

test("文件在修改后再次变化时拒绝撤销", async () => {
  const original = "const value = 1;\nexport { value };\n";
  await withFixture(original, async ({ path, workspace, registry }) => {
    registry.beginTask(workspace, "撤销冲突保护");
    await observeFile(registry, workspace);
    await registry.execute(
      patchCall("const value = 1;", "const value = 2;"),
      workspace,
      signal,
      { requestApproval: async () => "approved" },
    );
    registry.finishTask();

    await writeFile(path, "const value = 3;\nexport { value };\n", "utf8");
    await assert.rejects(
      registry.undoLatest(workspace, signal, async () => "approved"),
      /修改后发生变化/,
    );
  });
});

type Fixture = {
  path: string;
  workspace: WorkspaceContext;
  registry: ToolRegistry;
};

async function withFixture(
  content: string,
  run: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "codemuse-patch-"));
  try {
    const source = join(root, "src");
    const path = join(source, "example.ts");
    await mkdir(source);
    await writeFile(path, content, "utf8");
    const workspace = await openWorkspace(root);
    const registry = createCodingToolRegistry();
    await run({ path, workspace, registry });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function observeFile(
  registry: ToolRegistry,
  workspace: WorkspaceContext,
): Promise<void> {
  await registry.execute(
    {
      id: "read",
      name: "read_file",
      arguments: JSON.stringify({ path: "src/example.ts" }),
    },
    workspace,
    signal,
  );
}

function patchCall(oldText: string, newText: string) {
  return {
    id: "patch",
    name: "apply_patch",
    arguments: JSON.stringify({
      path: "src/example.ts",
      oldText,
      newText,
    }),
  };
}

async function applyPatch(
  registry: ToolRegistry,
  workspace: WorkspaceContext,
  patch: { oldText: string; newText: string },
  decision: "approved" | "denied",
) {
  return registry.execute(
    patchCall(patch.oldText, patch.newText),
    workspace,
    signal,
    { requestApproval: async () => decision },
  );
}
