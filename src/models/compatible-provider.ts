import type { ChatMessage, ModelConfig, ModelProvider } from "../types.ts";

type StreamChunk = {
  choices?: Array<{ delta?: { content?: string | null } }>;
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
    signal: AbortSignal,
  ): AsyncGenerator<string> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: this.config.model, messages, stream: true }),
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
        const content = parseSseLine(line);
        if (content) yield content;
      }
    }
    if (buffer) {
      const content = parseSseLine(buffer);
      if (content) yield content;
    }
  }
}

function parseSseLine(line: string): string | null {
  const value = line.trim();
  if (!value.startsWith("data:")) return null;
  const payload = value.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;

  let parsed: StreamChunk;
  try {
    parsed = JSON.parse(payload) as StreamChunk;
  } catch {
    return null;
  }
  if (parsed.error?.message) throw new Error(parsed.error.message);
  return parsed.choices?.[0]?.delta?.content ?? null;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
