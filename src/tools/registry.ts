import {
  ChangeJournal,
  type ChangeSummary,
} from "../changes/change-journal.ts";
import { createHash } from "node:crypto";
import type {
  ApprovalHandler,
  ToolCall,
  ToolDefinition,
  UndoResult,
} from "../types.ts";
import type { WorkspaceContext } from "../context/workspace.ts";
import {
  readGitStatus,
  type GitStatusSnapshot,
} from "./git/git-status.ts";
import type {
  AgentTool,
  ToolExecutionResult,
  ToolRisk,
  ToolRuntimeOptions,
} from "./types.ts";

const MAX_MODEL_CONTENT = 24_000;
const denyApproval: ApprovalHandler = async () => "denied";

export type GitStatusReader = (
  workspace: WorkspaceContext,
  signal: AbortSignal,
) => Promise<GitStatusSnapshot>;

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();
  private readonly changes = new ChangeJournal();
  private readonly observedFiles = new Map<string, string>();
  private scriptsListed = false;
  private gitBaseline: GitStatusSnapshot | null = null;
  private readonly gitStatusReader: GitStatusReader;

  constructor(gitStatusReader: GitStatusReader = readGitStatus) {
    this.gitStatusReader = gitStatusReader;
  }

  register(tool: AgentTool): this {
    const name = tool.definition.function.name;
    if (this.tools.has(name)) {
      throw new Error(`工具重复注册：${name}`);
    }
    this.tools.set(name, tool);
    return this;
  }

  definitions(allowedRisks?: readonly ToolRisk[]): ToolDefinition[] {
    return [...this.tools.values()]
      .filter((tool) => !allowedRisks || allowedRisks.includes(tool.risk))
      .map((tool) => tool.definition);
  }

  beginTask(workspace: WorkspaceContext, task: string): void {
    this.observedFiles.clear();
    this.scriptsListed = false;
    this.gitBaseline = null;
    this.changes.beginTask(workspace, task);
  }

  finishTask(): void {
    this.observedFiles.clear();
    this.scriptsListed = false;
    this.gitBaseline = null;
    this.changes.finishTask();
  }

  getActiveChangeSummary(): ChangeSummary {
    return this.changes.activeSummary();
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
    if (runtime.allowedRisks && !runtime.allowedRisks.includes(tool.risk)) {
      throw new Error(
        "当前任务策略不允许 " + tool.risk + " 工具：" + call.name,
      );
    }

    let rawInput: unknown;
    try {
      rawInput = call.arguments.trim() ? JSON.parse(call.arguments) : {};
    } catch {
      throw new Error(`工具 ${call.name} 的参数不是有效 JSON`);
    }

    const input = tool.validate(rawInput);
    if (tool.risk === "write" && runtime.executionScope) {
      const requestedPaths = extractWritePaths(call.name, input);
      if (
        requestedPaths.length === 0 ||
        requestedPaths.some((path) => !isPathInScope(path, runtime.executionScope!))
      ) {
        throw new Error(
          `工具 ${call.name} 请求了计划范围外的写入：${
            requestedPaths.join("、") || "无法识别路径"
          }`,
        );
      }
    }
    if (tool.risk === "write") {
      await this.ensureGitBaseline(workspace, signal);
    }
    const value = await tool.execute(input, {
      workspace,
      signal,
      changes: this.changes,
      requestApproval: runtime.requestApproval ?? denyApproval,
      hasObservedFile: (path) => this.observedFiles.has(path),
      getObservedFileFingerprint: (path) =>
        this.observedFiles.get(path) ?? null,
      hasListedScripts: () => this.scriptsListed,
      getGitBaseline: () => this.ensureGitBaseline(workspace, signal),
      getAgentChangeSummary: () => this.changes.activeSummary(),
    });

    if (
      call.name === "read_file" &&
      value &&
      typeof value === "object" &&
      "path" in value &&
      typeof value.path === "string"
    ) {
      const fingerprint = "fingerprint" in value &&
          typeof value.fingerprint === "string"
        ? value.fingerprint
        : createHash("sha256").update(
          "content" in value && typeof value.content === "string"
            ? value.content
            : "",
        ).digest("hex");
      this.observedFiles.set(value.path, fingerprint);
    }
    if (call.name === "list_scripts") this.scriptsListed = true;

    const serialized = JSON.stringify(value, null, 2);
    return {
      value,
      modelContent:
        serialized.length <= MAX_MODEL_CONTENT
          ? serialized
          : `${serialized.slice(0, MAX_MODEL_CONTENT)}\n...工具结果已截断`,
      summary: tool.summarize(value),
      displayContent: tool.display?.(value),
    };
  }

  private async ensureGitBaseline(
    workspace: WorkspaceContext,
    signal: AbortSignal,
  ): Promise<GitStatusSnapshot> {
    if (!this.gitBaseline) {
      this.gitBaseline = await this.gitStatusReader(workspace, signal);
    }
    return this.gitBaseline;
  }
}

function extractWritePaths(name: string, input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const value = input as Record<string, unknown>;
  switch (name) {
    case "rename_file":
      return [value.fromPath, value.toPath].filter(
        (path): path is string => typeof path === "string",
      );
    case "apply_patch":
    case "create_file":
    case "delete_file":
      return typeof value.path === "string" ? [value.path] : [];
    case "apply_patch_set":
      return Array.isArray(value.patches)
        ? value.patches.flatMap((patch) =>
          patch &&
            typeof patch === "object" &&
            !Array.isArray(patch) &&
            "path" in patch &&
            typeof patch.path === "string"
            ? [patch.path]
            : []
        )
        : [];
    default:
      return [];
  }
}

function isPathInScope(path: string, scope: readonly string[]): boolean {
  const normalized = path.replaceAll("\\", "/");
  return scope.some((entry) => {
    const allowed = entry.replaceAll("\\", "/");
    if (allowed.endsWith("/**")) {
      return normalized.startsWith(allowed.slice(0, -2));
    }
    return normalized === allowed;
  });
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
