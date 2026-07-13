import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { openWorkspace } from "../src/context/workspace.ts";
import { createReadOnlyToolRegistry } from "../src/tools/create-read-only-tools.ts";

const fixture = resolve("tests/fixtures/sample-project");
const signal = new AbortController().signal;

test("list_files 列出源码并忽略 build", async () => {
  const workspace = await openWorkspace(fixture);
  const registry = createReadOnlyToolRegistry();
  const result = await registry.execute(
    {
      id: "list",
      name: "list_files",
      arguments: JSON.stringify({ path: ".", maxDepth: 3 }),
    },
    workspace,
    signal,
  );
  const value = result.value as {
    entries: Array<{ path: string }>;
  };
  const paths = value.entries.map((entry) => entry.path);

  assert.ok(paths.includes("src/"));
  assert.ok(paths.includes("src/index.ts"));
  assert.ok(!paths.some((path) => path.startsWith("build")));
});

test("read_file 按行读取并返回行号", async () => {
  const workspace = await openWorkspace(fixture);
  const registry = createReadOnlyToolRegistry();
  const result = await registry.execute(
    {
      id: "read",
      name: "read_file",
      arguments: JSON.stringify({ path: "src/index.ts", startLine: 2, endLine: 4 }),
    },
    workspace,
    signal,
  );
  const value = result.value as { content: string; startLine: number; endLine: number };

  assert.equal(value.startLine, 2);
  assert.equal(value.endLine, 4);
  assert.match(value.content, /3: export const productName = "CodeMuse"/);
});

test("search_code 返回真实匹配并忽略构建目录", async () => {
  const workspace = await openWorkspace(fixture);
  const registry = createReadOnlyToolRegistry();
  const result = await registry.execute(
    {
      id: "search",
      name: "search_code",
      arguments: JSON.stringify({ query: "CodeMuse", path: "." }),
    },
    workspace,
    signal,
  );
  const value = result.value as {
    matches: Array<{ path: string; line: number }>;
  };

  assert.deepEqual(value.matches.map((match) => match.path), ["src/index.ts"]);
  assert.equal(value.matches[0]?.line, 3);
});

test("拒绝路径越界和被忽略目录", async () => {
  const workspace = await openWorkspace(fixture);
  const registry = createReadOnlyToolRegistry();

  await assert.rejects(
    registry.execute(
      {
        id: "escape",
        name: "read_file",
        arguments: JSON.stringify({ path: "../outside.txt" }),
      },
      workspace,
      signal,
    ),
    /工作区之外/,
  );

  await assert.rejects(
    registry.execute(
      {
        id: "ignored",
        name: "read_file",
        arguments: JSON.stringify({ path: "build/generated.js" }),
      },
      workspace,
      signal,
    ),
    /安全规则忽略/,
  );
});

test("拒绝未知工具和无效 JSON", async () => {
  const workspace = await openWorkspace(fixture);
  const registry = createReadOnlyToolRegistry();

  await assert.rejects(
    registry.execute(
      { id: "unknown", name: "delete_file", arguments: "{}" },
      workspace,
      signal,
    ),
    /未知工具/,
  );

  await assert.rejects(
    registry.execute(
      { id: "invalid", name: "read_file", arguments: "{" },
      workspace,
      signal,
    ),
    /不是有效 JSON/,
  );
});
