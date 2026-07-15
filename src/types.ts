export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type PlanStep = {
  id: string;
  title: string;
  status: StepStatus;
};

export type TaskPlan = {
  task: string;
  steps: PlanStep[];
};

export type ProjectScan = {
  projectName: string;
  projectTypes: string[];
  languages: string[];
  frameworks: string[];
  packageManager: string | null;
  fileCount: number;
  files: string[];
  keyFiles: string[];
  truncated: boolean;
};

export type ContextFileSummary = {
  path: string;
  score: number;
  estimatedTokens: number;
  truncated: boolean;
};

export type ContextSummary = {
  budgetTokens: number;
  estimatedTokens: number;
  files: ContextFileSummary[];
  omittedFiles: number;
  truncated: boolean;
};

export type AgentSessionState = {
  project: ProjectScan | null;
  plan: TaskPlan | null;
  context: ContextSummary | null;
};

export type ApprovalDecision = "approved" | "denied";

export type ApprovalRequest = {
  id: string;
  kind: "write" | "undo" | "execute";
  title: string;
  summary: string;
  paths: string[];
  diff: string;
};

export type ApprovalHandler = (
  request: ApprovalRequest,
  signal: AbortSignal,
) => Promise<ApprovalDecision>;

export type UndoResult = {
  undone: boolean;
  task: string;
  restoredFiles: string[];
  summary: string;
};

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

export type ModelUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ModelStreamEvent =
  | { type: "text-delta"; content: string }
  | { type: "provider-notice"; message: string }
  | { type: "usage"; usage: ModelUsage }
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
  | { type: "project-scanned"; project: ProjectScan }
  | { type: "plan-updated"; plan: TaskPlan }
  | { type: "context-selected"; context: ContextSummary }
  | { type: "model-usage"; model: string; usage: ModelUsage }
  | { type: "tool-start"; id: string; name: string; summary: string }
  | { type: "tool-complete"; id: string; name: string; summary: string }
  | { type: "tool-failed"; id: string; name: string; error: string }
  | { type: "command-output"; content: string }
  | { type: "notice"; message: string }
  | { type: "error"; message: string }
  | { type: "complete"; summary?: string };

export type AgentResumeContext = {
  sessionId: string;
  createdAt: string;
  priorTask: string;
  status: "completed" | "failed" | "cancelled" | "stopped";
  summary: string | null;
  priorPlan: PlanStep[];
  recentActivities: string[];
};
export type AgentToolPolicy = "full" | "read-only" | "none";
export type AgentContextMode = "workspace" | "none";

export type AgentRunOptions = {
  signal: AbortSignal;
  workspace: string;
  requestApproval?: ApprovalHandler;
  resume?: AgentResumeContext;
  toolPolicy?: AgentToolPolicy;
  contextMode?: AgentContextMode;
};

export interface AgentRunner {
  readonly mode: "mock" | "model";
  readonly modelName: string;
  run(task: string, options: AgentRunOptions): AsyncGenerator<AgentEvent>;
  scan(options: AgentRunOptions): Promise<ProjectScan>;
  undo(options: AgentRunOptions): Promise<UndoResult>;
  getState(): AgentSessionState;
  restoreState(state: AgentSessionState): void;
  clearState(): void;
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
  timeoutMs?: number;
  maxRetries?: number;
};

export interface ModelProvider {
  readonly name: string;
  stream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    signal: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent>;
}
