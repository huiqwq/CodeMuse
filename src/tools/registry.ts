import { ChangeJournal } from "../changes/change-journal.ts";
import type {
  ApprovalHandler,
  ToolCall,
  ToolDefinition,
  UndoResult,
} from "../types.ts";
import type { WorkspaceContext } from "../context/workspace.ts";
import type {
  AgentTool,
  ToolExecutionResult,
  ToolRuntimeOptions,
} from "./types.ts";

const MAX_MODEL_CONTENT = 24_000;
const denyApproval: ApprovalHandler = async () => "denied";

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();
  private readonly changes = new ChangeJournal();
  private readonly observedFiles = new Set<string>();

  register(tool: AgentTool): this {
    const name = tool.definition.function.name;
    if (this.tools.has(name)) {
      throw new Error(`工具重复注册：${name}`);
    }
    this.tools.set(name, tool);
    return this;
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  beginTask(workspace: WorkspaceContext, task: string): void {
    this.observedFiles.clear();
    this.changes.beginTask(workspace, task);
  }

  finishTask(): void {
    this.observedFiles.clear();
    this.changes.finishTask();
  }

  undoLatest(
    workspace: WorkspaceContext,
    signal: AbortSignal,
    requestApproval?: ApprovalHandler,
  ): Promise<UndoResult> {
    return this.changes.undoLatest(workspace, signal, requestApproval);
  }

  async execute(
    call: ToolCall,
    workspace: WorkspaceContext,
    signal: AbortSignal,
    runtime: ToolRuntimeOptions = {},
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(call.name);
    if (!tool) throw new Error(`未知工具：${call.name}`);

    let rawInput: unknown;
    try {
      rawInput = call.arguments.trim() ? JSON.parse(call.arguments) : {};
    } catch {
      throw new Error(`工具 ${call.name} 的参数不是有效 JSON`);
    }

    const input = tool.validate(rawInput);
    const value = await tool.execute(input, {
      workspace,
      signal,
      changes: this.changes,
      requestApproval: runtime.requestApproval ?? denyApproval,
      hasObservedFile: (path) => this.observedFiles.has(path),
    });
    if (
      call.name === "read_file" &&
      value &&
      typeof value === "object" &&
      "path" in value &&
      typeof value.path === "string"
    ) {
      this.observedFiles.add(value.path);
    }
    const serialized = JSON.stringify(value, null, 2);

    return {
      value,
      modelContent:
        serialized.length <= MAX_MODEL_CONTENT
          ? serialized
          : `${serialized.slice(0, MAX_MODEL_CONTENT)}\n...工具结果已截断`,
      summary: tool.summarize(value),
    };
  }
}

export function expectObject(value: unknown, toolName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${toolName} 参数必须是对象`);
  }
  return value as Record<string, unknown>;
}

export function optionalString(
  object: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = object[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error(`${key} 必须是字符串`);
  return value;
}

export function requiredString(
  object: Record<string, unknown>,
  key: string,
): string {
  const value = object[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} 必须是非空字符串`);
  }
  return value;
}

export function requiredStringValue(
  object: Record<string, unknown>,
  key: string,
): string {
  const value = object[key];
  if (typeof value !== "string") throw new Error(`${key} 必须是字符串`);
  return value;
}

export function optionalInteger(
  object: Record<string, unknown>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = object[key];
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${key} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return value as number;
}

export function optionalBoolean(
  object: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = object[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${key} 必须是布尔值`);
  return value;
}
