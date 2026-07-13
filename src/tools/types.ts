import type {
  ApprovalHandler,
  ToolCall,
  ToolDefinition,
} from "../types.ts";
import type { ChangeJournal } from "../changes/change-journal.ts";
import type { WorkspaceContext } from "../context/workspace.ts";

export type ToolRisk = "read" | "write";

export type ToolContext = {
  workspace: WorkspaceContext;
  signal: AbortSignal;
  changes: ChangeJournal;
  requestApproval: ApprovalHandler;
  hasObservedFile: (path: string) => boolean;
};

export type ToolRuntimeOptions = {
  requestApproval?: ApprovalHandler;
};

export type ToolExecutionResult = {
  value: unknown;
  modelContent: string;
  summary: string;
};

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  readonly risk: ToolRisk;
  readonly definition: ToolDefinition;
  validate(input: unknown): TInput;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
  summarize(output: TOutput): string;
}

export type RegisteredToolCall = ToolCall;
