import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { CompatibleProvider } from "../src/models/compatible-provider.ts";
import type { ModelStreamEvent, ToolDefinition } from "../src/types.ts";

test("CompatibleProvider 解析流式文本和 Tool Call", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requestBody = JSON.parse(body) as Record<string, unknown>;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write('data: {"choices":[{"delta":{"content":"正在分析"},"finish_reason":null}]}\n\n');
      response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_","arguments":"{\\"path\\":"}}]},"finish_reason":null}]}\n\n');
      response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n');
      response.end("data: [DONE]\n\n");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const provider = new CompatibleProvider({
    provider: "test",
    apiKey: "secret",
    baseUrl: `http://127.0.0.1:${address.port}`,
    model: "test-model",
  });
  const tools: ToolDefinition[] = [{
    type: "function",
    function: {
      name: "read_file",
      description: "read",
      parameters: { type: "object" },
    },
  }];
  const events: ModelStreamEvent[] = [];

  try {
    for await (const event of provider.stream(
      [{ role: "user", content: "分析项目" }],
      tools,
      new AbortController().signal,
    )) {
      events.push(event);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }

  assert.ok(events.some((event) => event.type === "text-delta"));
  assert.equal(events.filter((event) => event.type === "tool-call-delta").length, 2);
  assert.ok(requestBody);
  const captured = requestBody as unknown as Record<string, unknown>;
  assert.equal((captured.tools as unknown[]).length, 1);
  assert.equal(captured.tool_choice, "auto");
});
