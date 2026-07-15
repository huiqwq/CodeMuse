import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openWorkspace } from "../src/context/workspace.ts";
import { createCodingToolRegistry } from "../src/tools/create-coding-tools.ts";
import type { ToolRegistry } from "../src/tools/registry.ts";
import type { WorkspaceContext } from "../src/context/workspace.ts";

const signal = new AbortController().signal;

test("create_file 拒绝已有路径、越界、忽略目录和二进制扩展名", async () => {
  await withWorkspace(async ({ workspace, registry }) => {
    registry.beginTask(workspace, "创建边界");

    await assert.rejects(
      execute(registry, workspace, "create_file", {
        path: "src/example.ts",
        content: "duplicate\n",
      }),
      /已经存在/,
    );
    await assert.rejects(
      execute(registry, workspace, "create_file", {
        path: "../escape.ts",
        content: "escape\n",
      }),
      /工作区之外/,
    );
    await assert.rejects(
      execute(registry, workspace, "create_file", {
        path: ".git/config",
        content: "unsafe\n",
      }),
      /安全规则忽略/,
    );
    await assert.rejects(
      execute(registry, workspace, "create_file", {
        path: "src/image.png",
        content: "not really an image",
      }),
      /二进制文件/,
    );

    registry.finishTask();
  });
});

test("create_file 默认拒绝，确认后创建并可撤销", async () => {
  await withWorkspace(async ({ root, workspace, registry }) => {
    registry.beginTask(workspace, "创建文件");
    const denied = await execute(registry, workspace, "create_file", {
      path: "src/new.ts",
      content: "export const created = true;\n",
    });
    assert.equal((denied.value as { created: boolean }).created, false);
    await assert.rejects(access(join(root, "src", "new.ts")));

    const created = await execute(
      registry,
      workspace,
      "create_file",
      {
        path: "src/new.ts",
        content: "export const created = true;\n",
      },
      async (request) => {
        assert.equal(request.kind, "write");
        assert.match(request.diff, /\+export const created/);
        return "approved";
      },
    );
    registry.finishTask();

    assert.equal((created.value as { created: boolean }).created, true);
    assert.match(await readFile(join(root, "src", "new.ts"), "utf8"), /created/);

    const undone = await registry.undoLatest(
      workspace,
      signal,
      async () => "approved",
    );
    assert.equal(undone.undone, true);
    await assert.rejects(access(join(root, "src", "new.ts")));
  });
});

test("重命名、局部修改和删除均需确认，并可按任务整体撤销", async () => {
  await withWorkspace(async ({ root, workspace, registry }) => {
    const original = "export const value = 1;\nexport const label = \"before\";\n";
    await writeFile(join(root, "src", "example.ts"), original, "utf8");
    registry.beginTask(workspace, "混合文件操作");
    let approvals = 0;

    await observe(registry, workspace, "src/example.ts");
    await execute(
      registry,
      workspace,
      "rename_file",
      { fromPath: "src/example.ts", toPath: "src/renamed.ts" },
      approve,
    );
    await observe(registry, workspace, "src/renamed.ts");
    await execute(
      registry,
      workspace,
      "apply_patch",
      {
        path: "src/renamed.ts",
        oldText: 'export const label = "before";',
        newText: 'export const label = "after";',
      },
      approve,
    );
    await observe(registry, workspace, "src/renamed.ts");
    await execute(
      registry,
      workspace,
      "delete_file",
      { path: "src/renamed.ts" },
      approve,
    );
    const summary = registry.getActiveChangeSummary();
    registry.finishTask();

    assert.equal(approvals, 3);
    assert.equal(summary.renamedFiles.length, 1);
    assert.equal(summary.modifiedFiles.length, 1);
    assert.equal(summary.deletedFiles.length, 1);
    await assert.rejects(access(join(root, "src", "example.ts")));
    await assert.rejects(access(join(root, "src", "renamed.ts")));

    const undone = await registry.undoLatest(
      workspace,
      signal,
      async (request) => {
        assert.equal(request.kind, "undo");
        assert.match(request.diff, /renamed\.ts/);
        return "approved";
      },
    );
    assert.equal(undone.undone, true);
    assert.equal(await readFile(join(root, "src", "example.ts"), "utf8"), original);
    await assert.rejects(access(join(root, "src", "renamed.ts")));

    async function approve() {
      approvals += 1;
      return "approved" as const;
    }
  });
});

test("确认期间目标被占用时拒绝创建和重命名", async () => {
  await withWorkspace(async ({ root, workspace, registry }) => {
    registry.beginTask(workspace, "并发目标保护");
    await assert.rejects(
      execute(
        registry,
        workspace,
        "create_file",
        { path: "src/race.ts", content: "agent\n" },
        async () => {
          await writeFile(join(root, "src", "race.ts"), "user\n", "utf8");
          return "approved";
        },
      ),
      /已经存在/,
    );
    assert.equal(await readFile(join(root, "src", "race.ts"), "utf8"), "user\n");

    await observe(registry, workspace, "src/example.ts");
    await assert.rejects(
      execute(
        registry,
        workspace,
        "rename_file",
        { fromPath: "src/example.ts", toPath: "src/taken.ts" },
        async () => {
          await writeFile(join(root, "src", "taken.ts"), "user target\n", "utf8");
          return "approved";
        },
      ),
      /已经存在/,
    );
    assert.match(await readFile(join(root, "src", "example.ts"), "utf8"), /value/);
    registry.finishTask();
  });
});

type Fixture = {
  root: string;
  workspace: WorkspaceContext;
  registry: ToolRegistry;
};

async function withWorkspace(
  run: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "codemuse-files-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "example.ts"),
      "export const value = 1;\nexport {};\n",
      "utf8",
    );
    const workspace = await openWorkspace(root);
    await run({
      root,
      workspace,
      registry: createCodingToolRegistry(),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

async function observe(
  registry: ToolRegistry,
  workspace: WorkspaceContext,
  path: string,
): Promise<void> {
  await execute(registry, workspace, "read_file", { path });
}
