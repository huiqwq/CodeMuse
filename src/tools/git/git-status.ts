import {
  runGitProcess,
  type GitProcessRunner,
} from "./process-runner.ts";
import {
  expectObject,
} from "../registry.ts";
import type { AgentTool, ToolContext } from "../types.ts";
import type { WorkspaceContext } from "../../context/workspace.ts";
import type { ChangeSummary } from "../../changes/change-journal.ts";
import { isIgnoredRelativePath } from "../../context/ignore-rules.ts";

const GIT_TIMEOUT_MS = 10_000;

export type GitStatusEntry = {
  code: string;
  path: string;
  originalPath?: string;
};

export type GitStatusSnapshot = {
  isRepository: boolean;
  branch: string | null;
  entries: GitStatusEntry[];
  outputTruncated: boolean;
  message: string;
};

export type ClassifiedGitStatusEntry = GitStatusEntry & {
  origin: "user-existing" | "agent" | "user-and-agent" | "user";
};

export type GitStatusOutput = GitStatusSnapshot & {
  entries: ClassifiedGitStatusEntry[];
  agentChangeSummary: ChangeSummary;
};

export class GitStatusTool implements AgentTool<Record<string, never>, GitStatusOutput> {
  readonly risk = "read" as const;
  readonly definition = {
    type: "function" as const,
    function: {
      name: "git_status",
      description:
        "只读查看当前 Git 分支和工作区状态，并区分任务开始前已有改动与本次 Agent 涉及的路径。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  };

  private readonly runner: GitProcessRunner;

  constructor(runner: GitProcessRunner = runGitProcess) {
    this.runner = runner;
  }

  validate(input: unknown): Record<string, never> {
    const object = expectObject(input, "git_status");
    if (Object.keys(object).length) throw new Error("git_status 不接受参数");
    return {};
  }

  async execute(
    _input: Record<string, never>,
    context: ToolContext,
  ): Promise<GitStatusOutput> {
    const [baseline, current] = await Promise.all([
      context.getGitBaseline(),
      readGitStatus(context.workspace, context.signal, this.runner),
    ]);
    const agentChangeSummary = context.getAgentChangeSummary();
    const baselinePaths = new Set(
      baseline.entries.flatMap((entry) =>
        entry.originalPath ? [entry.path, entry.originalPath] : [entry.path]
      ),
    );
    const agentPaths = new Set(agentChangeSummary.changedPaths);

    return {
      ...current,
      entries: current.entries.map((entry) => {
        const paths = entry.originalPath
          ? [entry.path, entry.originalPath]
          : [entry.path];
        const existed = paths.some((path) => baselinePaths.has(path));
        const touched = paths.some((path) => agentPaths.has(path));
        return {
          ...entry,
          origin: touched
            ? existed ? "user-and-agent" : "agent"
            : existed ? "user-existing" : "user",
        };
      }),
      agentChangeSummary,
    };
  }

  summarize(output: GitStatusOutput): string {
    if (!output.isRepository) return "当前工作区不是 Git 仓库";
    return `分支 ${output.branch ?? "detached HEAD"}，${output.entries.length} 项未提交变更`;
  }

  display(output: GitStatusOutput): string {
    if (!output.isRepository) return output.message;
    const lines = [
      `Git 分支：${output.branch ?? "detached HEAD"}`,
      `未提交变更：${output.entries.length}`,
    ];
    for (const entry of output.entries) {
      const renamed = entry.originalPath
        ? ` (${entry.originalPath} -> ${entry.path})`
        : "";
      lines.push(
        `  ${entry.code} ${entry.path}${renamed} [${originLabel(entry.origin)}]`,
      );
    }
    if (!output.entries.length) lines.push("  工作区干净");
    if (output.outputTruncated) lines.push("  Git 输出已截断");
    return lines.join("\n");
  }
}

export async function readGitStatus(
  workspace: WorkspaceContext,
  signal: AbortSignal,
  runner: GitProcessRunner = runGitProcess,
): Promise<GitStatusSnapshot> {
  let result;
  try {
    result = await runner({
      args: ["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"],
      cwd: workspace.root,
      timeoutMs: GIT_TIMEOUT_MS,
      signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isRepository: false,
      branch: null,
      entries: [],
      outputTruncated: false,
      message: `无法运行 Git：${message}`,
    };
  }

  if (result.timedOut) throw new Error("git status 执行超时");
  if (result.exitCode !== 0) {
    if (/not a git repository/i.test(result.stderr)) {
      return {
        isRepository: false,
        branch: null,
        entries: [],
        outputTruncated: result.outputTruncated,
        message: "当前工作区不是 Git 仓库",
      };
    }
    throw new Error(
      `git status 失败：${result.stderr.trim() || `退出码 ${result.exitCode ?? "unknown"}`}`,
    );
  }

  const parsed = parsePorcelainStatus(result.stdout);
  const entries = parsed.entries.filter((entry) =>
    !isIgnoredRelativePath(entry.path) &&
    (!entry.originalPath || !isIgnoredRelativePath(entry.originalPath))
  );
  return {
    isRepository: true,
    branch: parsed.branch,
    entries,
    outputTruncated: result.outputTruncated,
    message: entries.length ? "Git 状态读取完成" : "Git 工作区干净",
  };
}

export function parsePorcelainStatus(
  value: string,
): { branch: string | null; entries: GitStatusEntry[] } {
  const fields = value.split("\0");
  const first = fields.shift() ?? "";
  const branch = first.startsWith("## ")
    ? parseBranch(first.slice(3))
    : null;
  const entries: GitStatusEntry[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field || field.length < 4) continue;
    const code = field.slice(0, 2);
    const path = field.slice(3);
    if (code.includes("R") || code.includes("C")) {
      const originalPath = fields[index + 1];
      if (originalPath) {
        entries.push({ code, path, originalPath });
        index += 1;
        continue;
      }
    }
    entries.push({ code, path });
  }

  return { branch, entries };
}

function parseBranch(header: string): string | null {
  if (header.startsWith("No commits yet on ")) {
    return header.slice("No commits yet on ".length);
  }
  if (header.startsWith("Initial commit on ")) {
    return header.slice("Initial commit on ".length);
  }
  if (header.startsWith("HEAD (no branch)")) return null;
  return header.split("...", 1)[0]?.trim() || null;
}

function originLabel(
  origin: ClassifiedGitStatusEntry["origin"],
): string {
  switch (origin) {
    case "user-existing":
      return "任务前已有";
    case "agent":
      return "本次 Agent";
    case "user-and-agent":
      return "任务前已有 + Agent";
    case "user":
      return "任务期间其他改动";
  }
}
