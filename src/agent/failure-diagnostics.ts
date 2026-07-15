import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import type { RunScriptOutput } from "../tools/scripts/run-script.ts";

const MAX_EXCERPT_LINES = 20;
const MAX_EXCERPT_CHARS = 4_000;
const SOURCE_LOCATION_PATTERN = /(?:file:\/\/\/)?((?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?[^\s()\[\]{}'"<>:]+?\.(?:[cm]?[jt]sx?|json|vue|svelte|css|scss|html)):(\d+)(?::(\d+))?/gi;

export type FailureCategory =
  | "timeout"
  | "typecheck"
  | "test"
  | "lint"
  | "build"
  | "runtime";

export type FailureLocation = {
  path: string;
  line: number;
  column: number | null;
};

export type FailureDiagnostics = {
  script: string;
  category: FailureCategory;
  fingerprint: string;
  headline: string;
  locations: FailureLocation[];
  excerpt: string;
};

export function diagnoseScriptFailure(
  output: RunScriptOutput,
  workspaceRoot: string,
): FailureDiagnostics | null {
  if (!output.executed || output.success) return null;

  const rawOutput = [output.stderr, output.stdout].filter(Boolean).join("\n");
  const cleaned = stripAnsi(rawOutput);
  const lines = selectSignificantLines(cleaned);
  const category = classifyFailure(output, cleaned);
  const headline = selectHeadline(lines) ?? fallbackHeadline(output);
  const fingerprint = createFingerprint(category, lines, headline, workspaceRoot);

  return {
    script: output.script,
    category,
    fingerprint,
    headline,
    locations: extractLocations(cleaned, workspaceRoot),
    excerpt: limitExcerpt(lines.join("\n") || headline),
  };
}

export function formatRepairContext(
  diagnostics: FailureDiagnostics,
  appliedPatches: number,
): string {
  return [
    "CodeMuse 自动修复诊断：",
    JSON.stringify({
      ...diagnostics,
      appliedPatches,
      maxAppliedPatches: 3,
    }, null, 2),
    "处理要求：先读取或搜索诊断中的相关文件；只有用户任务明确要求修复时才能提出局部补丁；补丁获批后重新运行同一脚本验证。不得编造测试通过。",
  ].join("\n");
}

function classifyFailure(
  output: RunScriptOutput,
  content: string,
): FailureCategory {
  if (output.timedOut) return "timeout";
  const script = output.script.toLowerCase();
  if (script.startsWith("typecheck") || /\bTS\d{4}\b/.test(content)) {
    return "typecheck";
  }
  if (script.startsWith("test") || /\b(?:test|tests|suite)\b/i.test(content)) {
    return "test";
  }
  if (script.startsWith("lint") || /\b(?:eslint|lint)\b/i.test(content)) {
    return "lint";
  }
  if (script.startsWith("build")) return "build";
  return "runtime";
}

function selectSignificantLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const value = line.trim();
      if (!value) return false;
      return !/^(?:npm notice|npm warn|a complete log of this run|ℹ\s)/i.test(value);
    })
    .slice(0, MAX_EXCERPT_LINES);
}

function selectHeadline(lines: string[]): string | null {
  return lines.find((line) =>
    /(?:\berror\b|failed|failure|exception|cannot|expected|received|\bTS\d{4}\b)/i.test(line)
  )?.trim() ?? lines[0]?.trim() ?? null;
}

function fallbackHeadline(output: RunScriptOutput): string {
  if (output.timedOut) return `${output.script} 执行超时`;
  return `${output.script} 执行失败，退出码 ${output.exitCode ?? "unknown"}`;
}

function createFingerprint(
  category: FailureCategory,
  lines: string[],
  headline: string,
  workspaceRoot: string,
): string {
  const normalizedRoot = workspaceRoot.replace(/\\/g, "/").toLowerCase();
  const source = (lines.length ? lines : [headline])
    .slice(0, 12)
    .join("\n")
    .replace(/\\/g, "/")
    .toLowerCase()
    .replaceAll(normalizedRoot, "<workspace>")
    .replace(/:\d+(?::\d+)?/g, ":#:#")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|seconds?|s)\b/g, "<duration>")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256")
    .update(`${category}\n${source}`)
    .digest("hex")
    .slice(0, 16);
}

function extractLocations(
  content: string,
  workspaceRoot: string,
): FailureLocation[] {
  const locations = new Map<string, FailureLocation>();
  for (const match of content.matchAll(SOURCE_LOCATION_PATTERN)) {
    const rawPath = match[1];
    const line = Number(match[2]);
    const column = match[3] ? Number(match[3]) : null;
    if (!rawPath || !Number.isSafeInteger(line)) continue;
    const path = toWorkspaceRelativePath(rawPath, workspaceRoot);
    if (!path || /^(?:node_modules|dist|build|coverage)\//i.test(path)) continue;
    const key = `${path}:${line}:${column ?? ""}`;
    locations.set(key, { path, line, column });
    if (locations.size >= 12) break;
  }
  return [...locations.values()];
}

function toWorkspaceRelativePath(
  rawPath: string,
  workspaceRoot: string,
): string | null {
  const decoded = rawPath.replace(/^file:\/\/\//i, "");
  const absolutePath = isAbsolute(decoded)
    ? resolve(decoded)
    : resolve(workspaceRoot, decoded);
  const relativePath = relative(workspaceRoot, absolutePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..\\`) ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    return null;
  }
  return relativePath.replace(/\\/g, "/");
}

function limitExcerpt(content: string): string {
  return content.length <= MAX_EXCERPT_CHARS
    ? content
    : `${content.slice(0, MAX_EXCERPT_CHARS)}\n...诊断内容已截断`;
}

function stripAnsi(content: string): string {
  return content.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}
