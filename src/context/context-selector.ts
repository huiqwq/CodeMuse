import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import {
  containsBinaryBytes,
  isBinaryFileName,
} from "./ignore-rules.ts";
import {
  resolveWorkspacePath,
  type WorkspaceContext,
} from "./workspace.ts";
import {
  estimateTokens,
  truncateToTokenBudget,
} from "./token-budget.ts";
import type {
  ContextFileSummary,
  ContextSummary,
  ProjectScan,
} from "../types.ts";

const MAX_CANDIDATE_FILES = 300;
const MAX_SELECTED_FILES = 12;
const MAX_FILE_BYTES = 256_000;
const MAX_FILE_TOKENS = 1_600;

const TASK_ALIASES: Array<{ pattern: RegExp; terms: string[] }> = [
  { pattern: /模型|大模型|llm/i, terms: ["model", "provider", "agent", "chat"] },
  { pattern: /配置|环境变量/i, terms: ["config", "env", "setting"] },
  { pattern: /命令|终端|cli/i, terms: ["cli", "command", "terminal"] },
  { pattern: /测试|test/i, terms: ["test", "spec", "fixture"] },
  { pattern: /工具|调用/i, terms: ["tool", "call", "registry"] },
  { pattern: /上下文|token/i, terms: ["context", "token", "budget"] },
  { pattern: /目录|结构|项目/i, terms: ["src", "package", "readme", "tsconfig"] },
  { pattern: /入口|启动/i, terms: ["index", "main", "cli", "start"] },
];

const LOW_VALUE_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

export type SelectedContextFile = ContextFileSummary & {
  content: string;
};

export type ContextSelection = {
  summary: ContextSummary;
  files: SelectedContextFile[];
  modelContent: string;
};

type Candidate = {
  path: string;
  content: string;
  score: number;
};

export async function selectTaskContext(
  task: string,
  project: ProjectScan,
  workspace: WorkspaceContext,
  budgetTokens: number,
  signal: AbortSignal,
): Promise<ContextSelection> {
  const terms = collectTaskTerms(task);
  const rankedPaths = project.files
    .filter(isContextCandidate)
    .map((path) => ({ path, score: scorePath(path, terms, project.keyFiles) }))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, MAX_CANDIDATE_FILES);

  const candidates: Candidate[] = [];
  for (const ranked of rankedPaths) {
    if (signal.aborted) throw signal.reason;
    const content = await readCandidate(ranked.path, workspace);
    if (content === null) continue;
    candidates.push({
      path: ranked.path,
      content,
      score: ranked.score + scoreContent(content, terms),
    });
  }

  candidates.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

  const selected: SelectedContextFile[] = [];
  const preferredFileBudget = Math.min(
    MAX_FILE_TOKENS,
    Math.max(120, Math.floor(budgetTokens / 4)),
  );
  let usedTokens = 0;
  for (const candidate of candidates) {
    if (selected.length >= MAX_SELECTED_FILES || usedTokens >= budgetTokens) break;
    const header = `\n--- FILE ${candidate.path} ---\n`;
    const footer = `\n--- END FILE ${candidate.path} ---\n`;
    const wrapperTokens = estimateTokens(header + footer);
    const remaining = budgetTokens - usedTokens - wrapperTokens;
    if (remaining < 40) break;

    const limited = truncateToTokenBudget(
      candidate.content,
      Math.min(preferredFileBudget, remaining),
    );
    if (!limited.content) continue;

    const estimatedTokens = wrapperTokens + limited.estimatedTokens;
    selected.push({
      path: candidate.path,
      content: limited.content,
      score: candidate.score,
      estimatedTokens,
      truncated: limited.truncated,
    });
    usedTokens += estimatedTokens;
  }

  const omittedFiles = Math.max(0, candidates.length - selected.length);
  const summary: ContextSummary = {
    budgetTokens,
    estimatedTokens: usedTokens,
    files: selected.map(({ content: _content, ...file }) => file),
    omittedFiles,
    truncated: omittedFiles > 0 || selected.some((file) => file.truncated),
  };

  return {
    summary,
    files: selected,
    modelContent: selected
      .map((file) => `--- FILE ${file.path} ---\n${file.content}\n--- END FILE ${file.path} ---`)
      .join("\n\n"),
  };
}

export function formatProjectSummary(project: ProjectScan): string {
  return [
    `项目名称：${project.projectName}`,
    `项目类型：${project.projectTypes.join("、")}`,
    `主要语言：${project.languages.join("、") || "未识别"}`,
    `框架：${project.frameworks.join("、") || "未识别"}`,
    `包管理器：${project.packageManager ?? "未识别"}`,
    `文件数量：${project.fileCount}${project.truncated ? "（扫描已截断）" : ""}`,
    `关键文件：${project.keyFiles.join("、") || "未识别"}`,
  ].join("\n");
}

function collectTaskTerms(task: string): string[] {
  const terms = new Set<string>();
  for (const match of task.toLowerCase().matchAll(/[a-z_][a-z0-9_-]{1,}/g)) {
    terms.add(match[0]);
  }
  for (const match of task.matchAll(/[\p{Script=Han}]{2,8}/gu)) {
    terms.add(match[0]);
  }
  for (const alias of TASK_ALIASES) {
    if (alias.pattern.test(task)) alias.terms.forEach((term) => terms.add(term));
  }
  return [...terms].filter((term) => term.length >= 2);
}

function scorePath(path: string, terms: string[], keyFiles: string[]): number {
  const normalized = path.toLowerCase();
  let score = keyFiles.includes(path) ? 24 : 0;
  if (normalized.startsWith("src/")) score += 8;
  if (normalized.includes("test") || normalized.includes("spec")) score += 2;
  if (basename(normalized) === "package.json") score += 16;
  if (basename(normalized).startsWith("readme")) score += 10;
  for (const term of terms) {
    if (normalized.includes(term.toLowerCase())) score += 30;
  }
  return score;
}

function scoreContent(content: string, terms: string[]): number {
  const normalized = content.toLowerCase();
  let matches = 0;
  for (const term of terms) {
    let offset = 0;
    const needle = term.toLowerCase();
    while (matches < 20) {
      const index = normalized.indexOf(needle, offset);
      if (index === -1) break;
      matches += 1;
      offset = index + needle.length;
    }
  }
  return Math.min(60, matches * 4);
}

function isContextCandidate(path: string): boolean {
  const name = basename(path).toLowerCase();
  if (LOW_VALUE_FILES.has(name) || name.endsWith(".min.js") || name.endsWith(".map")) return false;
  if (isBinaryFileName(path)) return false;
  const extension = extname(name);
  return extension !== "" || name === "dockerfile" || name === "makefile";
}

async function readCandidate(
  path: string,
  workspace: WorkspaceContext,
): Promise<string | null> {
  try {
    const target = await resolveWorkspacePath(workspace, path);
    const info = await stat(target.absolutePath);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
    const buffer = await readFile(target.absolutePath);
    if (containsBinaryBytes(buffer)) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}
