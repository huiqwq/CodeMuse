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
import { ModelAgent } from "../src/agent/model-agent.ts";
import { createCodingToolRegistry } from "../src/tools/create-coding-tools.ts";
import type {
  ChatMessage,
  ModelProvider,
  ModelStreamEvent,
  ToolDefinition,
} from "../src/types.ts";

class RecordingProvider implements ModelProvider {
  readonly name = "recording/review";
  messages: ChatMessage[] = [];
  tools: ToolDefinition[] = [];

  async *stream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
  ): AsyncGenerator<ModelStreamEvent> {
    this.messages = structuredClone(messages);
    this.tools = structuredClone(tools);
    yield { type: "text-delta", content: "片段审查完成" };
    yield { type: "finish", reason: "stop" };
  }
}

test("片段审查不扫描本地文件且不给模型任何工具", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemuse-paste-agent-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "private.ts"),
      "export const localOnlySecret = 'must-not-be-sent';\n",
      "utf8",
    );
    const provider = new RecordingProvider();
    const agent = new ModelAgent(
      provider,
      createCodingToolRegistry(),
      1_000,
    );

    const events = [];
    for await (const event of agent.run(
      "审查粘贴代码：const value = 1;",
      {
        signal: new AbortController().signal,
        workspace: root,
        contextMode: "none",
        toolPolicy: "none",
      },
    )) {
      events.push(event);
    }

    const sent = JSON.stringify(provider.messages);
    assert.match(sent, /const value = 1/);
    assert.doesNotMatch(sent, /must-not-be-sent|private\.ts/);
    assert.deepEqual(provider.tools, []);
    assert.equal(agent.getState().project?.fileCount, 0);
    assert.ok(events.some((event) =>
      event.type === "step-complete" &&
      event.result === "未扫描本地项目"
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
