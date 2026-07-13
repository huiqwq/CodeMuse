import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelAgent } from "../src/agent/model-agent.ts";
import { createCodingToolRegistry } from "../src/tools/create-coding-tools.ts";
import type {
  ChatMessage,
  ModelProvider,
  ModelStreamEvent,
  ToolDefinition,
} from "../src/types.ts";

class PatchProvider implements ModelProvider {
  readonly name = "fake/patch-model";
  calls = 0;

  async *stream(
    _messages: ChatMessage[],
    tools: ToolDefinition[],
    _signal: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent> {
    this.calls += 1;
    assert.equal(tools.length, 6);

    if (this.calls === 1) {
      yield {
        type: "tool-call-delta",
        index: 0,
        id: "read-target",
        name: "read_file",
        arguments: JSON.stringify({ path: "src/example.ts" }),
      };
      yield { type: "finish", reason: "tool_calls" };
      return;
    }

    if (this.calls === 2) {
      yield {
        type: "tool-call-delta",
        index: 0,
        id: "patch-target",
        name: "apply_patch",
        arguments: JSON.stringify({
          path: "src/example.ts",
          oldText: "const value = 1;",
          newText: "const value = 2;",
        }),
      };
      yield { type: "finish", reason: "tool_calls" };
      return;
    }

    yield { type: "text-delta", content: "已完成局部修改。" };
    yield { type: "finish", reason: "stop" };
  }
}

test("ModelAgent 完成读取、授权写入并支持撤销", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemuse-agent-patch-"));
  try {
    const source = join(root, "src");
    const path = join(source, "example.ts");
    const original = "const value = 1;\nexport { value };\n";
    await mkdir(source);
    await writeFile(path, original, "utf8");

    const provider = new PatchProvider();
    const agent = new ModelAgent(provider, createCodingToolRegistry(), 500);
    let approvals = 0;
    const events = [];

    for await (const event of agent.run("把 value 修改为 2", {
      signal: new AbortController().signal,
      workspace: root,
      requestApproval: async (request) => {
        approvals += 1;
        assert.equal(request.kind, "write");
        assert.match(request.diff, /\+const value = 2;/);
        return "approved";
      },
    })) {
      events.push(event);
    }

    assert.equal(provider.calls, 3);
    assert.equal(approvals, 1);
    assert.match(await readFile(path, "utf8"), /value = 2/);
    assert.ok(
      events.some((event) =>
        event.type === "tool-complete" && event.name === "apply_patch"
      ),
    );

    const undo = await agent.undo({
      signal: new AbortController().signal,
      workspace: root,
      requestApproval: async (request) => {
        assert.equal(request.kind, "undo");
        return "approved";
      },
    });
    assert.equal(undo.undone, true);
    assert.equal(await readFile(path, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
