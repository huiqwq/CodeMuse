export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ModelStreamEvent =
  | { type: "text-delta"; content: string }
  | {
      type: "tool-call-delta";
      index: number;
      id?: string;
      name?: string;
      arguments?: string;
    }
  | { type: "finish"; reason?: string };

export type AgentEvent =
  | { type: "message-start" }
  | { type: "message-delta"; content: string }
  | { type: "message-complete" }
  | { type: "step-start"; id: string; title: string }
  | { type: "step-complete"; id: string; result?: string }
  | { type: "step-failed"; id: string; error: string }
  | { type: "tool-start"; id: string; name: string; summary: string }
  | { type: "tool-complete"; id: string; name: string; summary: string }
  | { type: "tool-failed"; id: string; name: string; error: string }
  | { type: "notice"; message: string }
  | { type: "error"; message: string }
  | { type: "complete"; summary?: string };

export type AgentRunOptions = {
  signal: AbortSignal;
  workspace: string;
};

export interface AgentRunner {
  readonly mode: "mock" | "model";
  readonly modelName: string;
  run(task: string, options: AgentRunOptions): AsyncGenerator<AgentEvent>;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };

export type ModelConfig = {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
};

export interface ModelProvider {
  readonly name: string;
  stream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    signal: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent>;
}
