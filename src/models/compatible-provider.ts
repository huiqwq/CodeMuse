import type {
  ChatMessage,
  ModelConfig,
  ModelProvider,
  ModelStreamEvent,
  ToolDefinition,
} from "../types.ts";

type StreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
};

export class CompatibleProvider implements ModelProvider {
  readonly name: string;
  private readonly config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
    this.name = `${config.provider}/${config.model}`;
  }

  async *stream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    signal: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map(toApiMessage),
      stream: true,
    };
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`模型请求失败 (${response.status}): ${truncate(detail, 300)}`);
    }
    if (!response.body) throw new Error("模型响应没有可读取的内容");

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        for (const event of parseSseLine(line)) yield event;
      }
    }
    if (buffer) {
      for (const event of parseSseLine(buffer)) yield event;
    }
  }
}

function toApiMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    };
  }

  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId,
    };
  }

  return message;
}

function parseSseLine(line: string): ModelStreamEvent[] {
  const value = line.trim();
  if (!value.startsWith("data:")) return [];
  const payload = value.slice(5).trim();
  if (!payload || payload === "[DONE]") return [];

  let parsed: StreamChunk;
  try {
    parsed = JSON.parse(payload) as StreamChunk;
  } catch {
    return [];
  }
  if (parsed.error?.message) throw new Error(parsed.error.message);

  const choice = parsed.choices?.[0];
  if (!choice) return [];

  const events: ModelStreamEvent[] = [];
  const content = choice.delta?.content;
  if (content) events.push({ type: "text-delta", content });

  for (const call of choice.delta?.tool_calls ?? []) {
    events.push({
      type: "tool-call-delta",
      index: call.index,
      id: call.id,
      name: call.function?.name,
      arguments: call.function?.arguments,
    });
  }

  if (choice.finish_reason) {
    events.push({ type: "finish", reason: choice.finish_reason });
  }
  return events;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
