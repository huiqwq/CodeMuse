export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentEvent =
  | { type: "message-start" }
  | { type: "message-delta"; content: string }
  | { type: "message-complete" }
  | { type: "step-start"; id: string; title: string }
  | { type: "step-complete"; id: string; result?: string }
  | { type: "step-failed"; id: string; error: string }
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

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelConfig = {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
};

export interface ModelProvider {
  readonly name: string;
  stream(messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<string>;
}
