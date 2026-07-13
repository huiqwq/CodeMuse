import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { ModelAgent } from "../src/agent/model-agent.ts";
import { createReadOnlyToolRegistry } from "../src/tools/create-read-only-tools.ts";
import type {
  ChatMessage,
  ModelProvider,
  ModelStreamEvent,
  ToolDefinition,
} from "../src/types.ts";

class FakeToolCallingProvider implements ModelProvider {
  readonly name = "fake/tool-model";
  calls = 0;
  receivedMessages: ChatMessage[][] = [];

  async *stream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    _signal: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent> {
    this.calls += 1;
    this.receivedMessages.push(structuredClone(messages));
    assert.equal(tools.length, 3);

    if (this.calls === 1) {
      yield {
        type: "tool-call-delta",
        index: 0,
        id: "call-list",
        name: "list_",
        arguments: '{"path":".",',
      };
      yield {
        type: "tool-call-delta",
        index: 0,
        name: "files",
        arguments: '"maxDepth":1}',
      };
      yield { type: "finish", reason: "tool_calls" };
      return;
    }

    yield { type: "text-delta", content: "已根据真实工具结果完成分析。" };
    yield { type: "finish", reason: "stop" };
  }
}

test("Agent Loop 执行工具并把结果返回模型", async () => {
  const provider = new FakeToolCallingProvider();
  const agent = new ModelAgent(provider, createReadOnlyToolRegistry());
  const events = [];

  for await (const event of agent.run("分析项目结构", {
    signal: new AbortController().signal,
    workspace: resolve("tests/fixtures/sample-project"),
  })) {
    events.push(event);
  }

  assert.equal(provider.calls, 2);
  assert.ok(events.some((event) => event.type === "tool-start" && event.name === "list_files"));
  assert.ok(events.some((event) => event.type === "tool-complete" && event.name === "list_files"));
  assert.ok(events.some((event) => event.type === "message-delta"));
  assert.ok(events.some((event) => event.type === "complete"));

  const firstRequest = provider.receivedMessages[0] ?? [];
  const initialUserMessage = firstRequest.find((message) => message.role === "user");
  assert.match(initialUserMessage?.content ?? "", /预选上下文/);
  assert.match(initialUserMessage?.content ?? "", /src\/index\.ts/);

  const secondRequest = provider.receivedMessages[1] ?? [];
  assert.ok(secondRequest.some((message) => message.role === "tool"));
});
