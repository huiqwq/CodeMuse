import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { CompatibleProvider } from "../src/models/compatible-provider.ts";
import type { ModelStreamEvent, ToolDefinition } from "../src/types.ts";

test("CompatibleProvider 解析流式文本、Tool Call 和 Token 用量", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const server = createServer((request, response) => {
    void readJson(request).then((body) => {
      requestBody = body;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write('data: {"choices":[{"delta":{"content":"正在分析"},"finish_reason":null}]}\n\n');
      response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_","arguments":"{\\"path\\":"}}]},"finish_reason":null}]}\n\n');
      response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n');
      response.write('data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":5,"total_tokens":105}}\n\n');
      response.write('data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":8,"total_tokens":128}}\n\n');
      response.end("data: [DONE]\n\n");
    });
  });

  const baseUrl = await listen(server);
  const provider = new CompatibleProvider({
    provider: "test",
    apiKey: "secret",
    baseUrl,
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

  try {
    const events = await collect(provider, tools);
    assert.ok(events.some((event) => event.type === "text-delta"));
    assert.equal(
      events.filter((event) => event.type === "tool-call-delta").length,
      2,
    );
    assert.equal(
      events.filter((event) => event.type === "usage").length,
      1,
    );
    assert.deepEqual(
      events.find((event) => event.type === "usage"),
      {
        type: "usage",
        usage: {
          promptTokens: 120,
          completionTokens: 8,
          totalTokens: 128,
        },
      },
    );
    assert.ok(requestBody);
    const captured = requestBody as unknown as Record<string, unknown>;
    assert.equal((captured.tools as unknown[]).length, 1);
    assert.equal(captured.tool_choice, "auto");
    assert.deepEqual(captured.stream_options, { include_usage: true });
  } finally {
    await close(server);
  }
});

test("CompatibleProvider 对 429 和 5xx 有限重试", async () => {
  let calls = 0;
  const server = createServer((_request, response) => {
    calls += 1;
    if (calls === 1) {
      response.writeHead(429, { "Retry-After": "0" });
      response.end("rate limited");
      return;
    }
    if (calls === 2) {
      response.writeHead(503);
      response.end("temporarily unavailable");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n');
    response.end("data: [DONE]\n\n");
  });

  const baseUrl = await listen(server);
  const provider = new CompatibleProvider(
    {
      provider: "retry",
      apiKey: "secret",
      baseUrl,
      model: "retry-model",
      maxRetries: 2,
    },
    { sleep: async () => undefined },
  );

  try {
    const events = await collect(provider, []);
    assert.equal(calls, 3);
    assert.ok(events.some((event) =>
      event.type === "provider-notice" &&
      event.message.includes("第 3 次")
    ));
  } finally {
    await close(server);
  }
});

test("CompatibleProvider 在临时网络错误后重试", async () => {
  let calls = 0;
  const provider = new CompatibleProvider(
    {
      provider: "network",
      apiKey: "secret",
      baseUrl: "https://network.example.test/v1",
      model: "network-model",
      maxRetries: 1,
    },
    {
      fetch: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("temporary network failure");
        return new Response(
          'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        );
      },
      sleep: async () => undefined,
    },
  );

  const events = await collect(provider, []);
  assert.equal(calls, 2);
  assert.ok(events.some((event) =>
    event.type === "provider-notice" && event.message.includes("第 2 次")
  ));
});
test("CompatibleProvider 不重试 401 且错误信息脱敏", async () => {
  let calls = 0;
  const apiKey = "private-provider-key-123";
  const server = createServer((_request, response) => {
    calls += 1;
    response.writeHead(401);
    response.end(`invalid key ${apiKey}`);
  });

  const baseUrl = await listen(server);
  const provider = new CompatibleProvider({
    provider: "auth",
    apiKey,
    baseUrl,
    model: "auth-model",
    maxRetries: 3,
  });

  try {
    await assert.rejects(
      collect(provider, []),
      (error: unknown) => {
        assert.equal(calls, 1);
        assert.ok(error instanceof Error);
        assert.match(error.message, /401/);
        assert.doesNotMatch(error.message, new RegExp(apiKey));
        assert.match(error.message, /\[REDACTED\]/);
        return true;
      },
    );
  } finally {
    await close(server);
  }
});

test("CompatibleProvider 使用最小非流式请求测试连接", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const server = createServer((request, response) => {
    void readJson(request).then((body) => {
      requestBody = body;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "OK" } }],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 1,
          total_tokens: 6,
        },
      }));
    });
  });

  const baseUrl = await listen(server);
  const provider = new CompatibleProvider({
    provider: "connect",
    apiKey: "secret",
    baseUrl,
    model: "connect-model",
  });

  try {
    const result = await provider.testConnection(
      new AbortController().signal,
    );
    assert.equal(result.attempts, 1);
    assert.equal(result.usage?.totalTokens, 6);
    assert.ok(requestBody);
    const captured = requestBody as unknown as Record<string, unknown>;
    assert.equal(captured.stream, false);
    assert.equal(captured.max_tokens, 1);
  } finally {
    await close(server);
  }
});

async function collect(
  provider: CompatibleProvider,
  tools: ToolDefinition[],
): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of provider.stream(
    [{ role: "user", content: "分析项目" }],
    tools,
    new AbortController().signal,
  )) {
    events.push(event);
  }
  return events;
}

async function listen(
  server: ReturnType<typeof createServer>,
): Promise<string> {
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve)
  );
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );
}

async function readJson(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return JSON.parse(body) as Record<string, unknown>;
}
