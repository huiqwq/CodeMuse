import type {
  ApprovalHandler,
  ToolCall,
  ToolDefinition,
} from "../types.ts";
import type {
  ChangeJournal,
  ChangeSummary,
} from "../changes/change-journal.ts";
import type { GitStatusSnapshot } from "./git/git-status.ts";
import type { WorkspaceContext } from "../context/workspace.ts";

export type ToolRisk = "read" | "write" | "execute";

export type ToolContext = {
  workspace: WorkspaceContext;
  signal: AbortSignal;
  changes: ChangeJournal;
  requestApproval: ApprovalHandler;
  hasObservedFile: (path: string) => boolean;
  hasListedScripts: () => boolean;
  getGitBaseline: () => Promise<GitStatusSnapshot>;
  getAgentChangeSummary: () => ChangeSummary;
};

export type ToolRuntimeOptions = {
  requestApproval?: ApprovalHandler;
};

export type ToolExecutionResult = {
  value: unknown;
  modelContent: string;
  summary: string;
  displayContent?: string;
};

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  readonly risk: ToolRisk;
  readonly definition: ToolDefinition;
  validate(input: unknown): TInput;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
  summarize(output: TOutput): string;
  display?(output: TOutput): string | undefined;
}

export type RegisteredToolCall = ToolCall;
