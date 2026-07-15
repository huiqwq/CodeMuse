import { resolveWorkspacePath } from "../../context/workspace.ts";
import {
  expectObject,
  optionalBoolean,
  optionalString,
} from "../registry.ts";
import {
  runGitProcess,
  type GitProcessRunner,
} from "./process-runner.ts";
import type { AgentTool, ToolContext } from "../types.ts";

const GIT_TIMEOUT_MS = 10_000;
const SAFE_REPOSITORY_PATHS = [
  ".",
  ":(exclude).git/**",
  ":(exclude)**/.git/**",
  ":(exclude).codemuse/**",
  ":(exclude)**/.codemuse/**",
  ":(exclude)node_modules/**",
  ":(exclude)**/node_modules/**",
  ":(exclude)dist/**",
  ":(exclude)**/dist/**",
  ":(exclude)build/**",
  ":(exclude)**/build/**",
  ":(exclude)coverage/**",
  ":(exclude)**/coverage/**",
  ":(exclude).next/**",
  ":(exclude)**/.next/**",
  ":(exclude).cache/**",
  ":(exclude)**/.cache/**",
  ":(exclude)out/**",
  ":(exclude)**/out/**",
  ":(exclude).env",
  ":(exclude)**/.env",
  ":(exclude).env.*",
  ":(exclude)**/.env.*",
  ":(exclude).npmrc",
  ":(exclude)**/.npmrc",
  ":(exclude).pypirc",
  ":(exclude)**/.pypirc",
  ":(exclude)**/id_rsa",
  ":(exclude)**/id_ed25519",
];

export type GitDiffInput = {
  staged: boolean;
  path: string;
};

export type GitDiffOutput = {
  isRepository: boolean;
  staged: boolean;
  path: string | null;
  diff: string;
  outputTruncated: boolean;
  durationMs: number;
  message: string;
};

export class GitDiffTool implements AgentTool<GitDiffInput, GitDiffOutput> {
  readonly risk = "read" as const;
  readonly definition = {
    type: "function" as const,
    function: {
      name: "git_diff",
      description:
        "只读查看未暂存或已暂存的 Git Diff。不会执行 add、commit、checkout、reset 或 push。",
      parameters: {
        type: "object",
        properties: {
          staged: {
            type: "boolean",
            description: "true 查看已暂存 Diff，默认 false 查看工作区 Diff",
          },
          path: {
            type: "string",
            description: "可选的工作区相对文件路径",
          },
        },
        additionalProperties: false,
      },
    },
  };

  private readonly runner: GitProcessRunner;

  constructor(runner: GitProcessRunner = runGitProcess) {
    this.runner = runner;
  }

  validate(input: unknown): GitDiffInput {
    const object = expectObject(input, "git_diff");
    return {
      staged: optionalBoolean(object, "staged", false),
      path: optionalString(object, "path", "").trim(),
    };
  }

  async execute(
    input: GitDiffInput,
    context: ToolContext,
  ): Promise<GitDiffOutput> {
    let path: string | null = null;
    if (input.path) {
      path = (await resolveWorkspacePath(context.workspace, input.path)).relativePath;
    }

    const args = ["diff", "--no-ext-diff", "--no-color"];
    if (input.staged) args.push("--cached");
    args.push("--");
    if (path) {
      args.push(path);
    } else {
      args.push(...SAFE_REPOSITORY_PATHS);
    }

    let result;
    try {
      result = await this.runner({
        args,
        cwd: context.workspace.root,
        timeoutMs: GIT_TIMEOUT_MS,
        signal: context.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isRepository: false,
        staged: input.staged,
        path,
        diff: "",
        outputTruncated: false,
        durationMs: 0,
        message: `无法运行 Git：${message}`,
      };
    }

    if (result.timedOut) throw new Error("git diff 执行超时");
    if (result.exitCode !== 0) {
      if (/not a git repository/i.test(result.stderr)) {
        return {
          isRepository: false,
          staged: input.staged,
          path,
          diff: "",
          outputTruncated: result.outputTruncated,
          durationMs: result.durationMs,
          message: "当前工作区不是 Git 仓库",
        };
      }
      throw new Error(
        `git diff 失败：${result.stderr.trim() || `退出码 ${result.exitCode ?? "unknown"}`}`,
      );
    }

    return {
      isRepository: true,
      staged: input.staged,
      path,
      diff: result.stdout,
      outputTruncated: result.outputTruncated,
      durationMs: result.durationMs,
      message: result.stdout
        ? "Git Diff 读取完成"
        : "当前范围没有 Git Diff",
    };
  }

  summarize(output: GitDiffOutput): string {
    if (!output.isRepository) return "当前工作区不是 Git 仓库";
    return output.diff
      ? `读取${output.staged ? "已暂存" : "未暂存"} Git Diff`
      : "当前范围没有 Git Diff";
  }

  display(output: GitDiffOutput): string {
    if (!output.isRepository) return output.message;
    const title = output.staged ? "git diff --cached" : "git diff";
    return [
      `$ ${title}${output.path ? ` -- ${output.path}` : ""}`,
      output.diff.trimEnd() || "(无差异)",
      output.outputTruncated ? "...Git Diff 已截断" : "",
    ].filter(Boolean).join("\n");
  }
}
