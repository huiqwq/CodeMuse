import type {
  ChatMessage,
  ModelConfig,
  ModelProvider,
  ModelStreamEvent,
  ModelUsage,
  ToolDefinition,
} from "../types.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_ERROR_DETAIL = 300;
const MAX_RETRY_DELAY_MS = 5_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

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
  usage?: ApiUsage;
};

type ApiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
};

export type ModelConnectionResult = {
  provider: string;
  model: string;
  latencyMs: number;
  attempts: number;
  usage: ModelUsage | null;
  message: string;
};

export type CompatibleProviderOptions = {
  fetch?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export class CompatibleProvider implements ModelProvider {
  readonly name: string;
  private readonly config: ModelConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(
    config: ModelConfig,
    options: CompatibleProviderOptions = {},
  ) {
    this.config = config;
    this.name = `${config.provider}/${config.model}`;
    this.fetchImpl = options.fetch ?? fetch;
    this.sleepImpl = options.sleep ?? wait;
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
      stream_options: { include_usage: true },
    };
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const requested = await this.requestWithRetry(body, signal);
    if (requested.attempts > 1) {
      yield {
        type: "provider-notice",
        message: `模型请求在第 ${requested.attempts} 次尝试后成功`,
      };
    }
    const response = requested.response;
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `模型请求失败 (${response.status}): ${this.safeDetail(detail)}`,
      );
    }
    if (!response.body) throw new Error("模型响应没有可读取的内容");

    const decoder = new TextDecoder();
    let buffer = "";
    let finalUsage: ModelUsage | null = null;
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        for (const event of parseSseLine(line)) {
          if (event.type === "usage") {
            finalUsage = event.usage;
          } else {
            yield event;
          }
        }
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      for (const event of parseSseLine(buffer)) {
        if (event.type === "usage") {
          finalUsage = event.usage;
        } else {
          yield event;
        }
      }
    }
    if (finalUsage) yield { type: "usage", usage: finalUsage };
  }

  async testConnection(signal: AbortSignal): Promise<ModelConnectionResult> {
    const startedAt = Date.now();
    const body = {
      model: this.config.model,
      messages: [{
        role: "user",
        content: "Reply with OK.",
      }],
      stream: false,
      max_tokens: 1,
    };
    const requested = await this.requestWithRetry(body, signal);
    const response = requested.response;
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `模型连接测试失败 (${response.status}): ${this.safeDetail(detail)}`,
      );
    }

    let usage: ModelUsage | null = null;
    try {
      const payload = await response.json() as { usage?: ApiUsage };
      usage = normalizeUsage(payload.usage);
    } catch {
      // A successful response is enough for the connectivity check.
    }
    return {
      provider: this.config.provider,
      model: this.config.model,
      latencyMs: Date.now() - startedAt,
      attempts: requested.attempts,
      usage,
      message: "模型连接测试成功",
    };
  }

  private async requestWithRetry(
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ response: Response; attempts: number }> {
    const maxRetries = this.config.maxRetries ?? DEFAULT_MAX_RETRIES;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (signal.aborted) throw signal.reason;
      try {
        const response = await this.fetchWithTimeout(body, signal);
        if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxRetries) {
          return { response, attempts: attempt + 1 };
        }
        const delay = retryDelay(response, attempt);
        await response.body?.cancel().catch(() => undefined);
        await this.sleepImpl(delay, signal);
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        lastError = error;
        if (attempt === maxRetries) break;
        await this.sleepImpl(backoffDelay(attempt), signal);
      }
    }

    const message = lastError instanceof Error
      ? lastError.message
      : String(lastError ?? "未知网络错误");
    throw new Error(`模型请求失败：${this.safeDetail(message)}`);
  }

  private fetchWithTimeout(
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Response> {
    const timeoutSignal = AbortSignal.timeout(
      this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    return this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, timeoutSignal]),
    });
  }

  private safeDetail(value: string): string {
    const sanitized = value.split(this.config.apiKey).join("[REDACTED]");
    return truncate(sanitized, MAX_ERROR_DETAIL);
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

  const events: ModelStreamEvent[] = [];
  const usage = normalizeUsage(parsed.usage);
  if (usage) events.push({ type: "usage", usage });

  const choice = parsed.choices?.[0];
  if (!choice) return events;

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

function normalizeUsage(value: ApiUsage | undefined): ModelUsage | null {
  if (!value) return null;
  const promptTokens = nonNegativeInteger(
    value.prompt_tokens ?? value.input_tokens,
  );
  const completionTokens = nonNegativeInteger(
    value.completion_tokens ?? value.output_tokens,
  );
  const reportedTotal = nonNegativeInteger(value.total_tokens);
  const totalTokens = reportedTotal ?? (
    promptTokens !== null && completionTokens !== null
      ? promptTokens + completionTokens
      : null
  );
  if (totalTokens === null) return null;
  return {
    promptTokens: promptTokens ?? Math.max(0, totalTokens - (completionTokens ?? 0)),
    completionTokens: completionTokens ?? 0,
    totalTokens,
  };
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0
    ? value as number
    : null;
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_RETRY_DELAY_MS, seconds * 1_000);
    }
    const date = Date.parse(header);
    if (Number.isFinite(date)) {
      return Math.min(
        MAX_RETRY_DELAY_MS,
        Math.max(0, date - Date.now()),
      );
    }
  }
  return backoffDelay(attempt);
}

function backoffDelay(attempt: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 250 * 2 ** attempt);
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
