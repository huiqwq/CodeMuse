import type { ToolCall, ToolDefinition } from "../types.ts";
import type { WorkspaceContext } from "../context/workspace.ts";

export type ToolContext = {
  workspace: WorkspaceContext;
  signal: AbortSignal;
};

export type ToolExecutionResult = {
  value: unknown;
  modelContent: string;
  summary: string;
};

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  readonly definition: ToolDefinition;
  validate(input: unknown): TInput;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
  summarize(output: TOutput): string;
}

export type RegisteredToolCall = ToolCall;
