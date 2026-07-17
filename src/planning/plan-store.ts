import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createWorkspaceCheckpoint } from "../sessions/checkpoint.ts";
import type {
  ContextSummary,
  PlanArtifact,
  PlanArtifactStatus,
  PlanArtifactStep,
  ProjectScan,
} from "../types.ts";
import { WorkspaceDataFile } from "../workspace/data-file.ts";

const SCHEMA_VERSION = 1;
const MAX_SCOPE = 100;
const MAX_STEPS = 20;
const MAX_TEXT = 4_000;

type PlanFile = {
  schemaVersion: 1;
  plan: PlanArtifact | null;
};

export class PlanStore {
  private readonly data: WorkspaceDataFile;
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.data = new WorkspaceDataFile(workspaceRoot, "plan.json");
  }

  async load(): Promise<PlanArtifact | null> {
    const value = await this.data.read();
    if (value === null) return null;
    return structuredClone(validatePlanFile(value).plan);
  }

  async save(plan: PlanArtifact): Promise<PlanArtifact> {
    const validated = validatePlan(plan);
    await this.data.write({ schemaVersion: SCHEMA_VERSION, plan: validated });
    return structuredClone(validated);
  }

  async clear(): Promise<void> {
    await this.data.remove();
  }

  async create(
    objective: string,
    project: ProjectScan | null,
    context: ContextSummary | null,
    modelNotes: string,
  ): Promise<PlanArtifact> {
    const checkpoint = await createWorkspaceCheckpoint(
      this.workspaceRoot,
      new AbortController().signal,
    );
    const now = new Date().toISOString();
    const plan: PlanArtifact = {
      id: randomUUID(),
      revision: 1,
      objective: limitText(objective, MAX_TEXT),
      scope: inferScope(project, context, modelNotes),
      steps: inferSteps(modelNotes),
      validation: await inferValidation(this.workspaceRoot),
      risks: [
        "工作区可能在计划批准前发生变化",
        "模型提出的实现细节必须以实际代码和验证结果为准",
      ],
      assumptions: [
        "只修改计划范围内且与目标直接相关的文件",
        "写入与命令执行遵循当前授权模式",
      ],
      revisionNotes: [],
      workspaceFingerprint: checkpoint.fingerprint,
      workspaceFileCount: checkpoint.fileCount,
      workspaceTruncated: checkpoint.truncated,
      status: "ready",
      createdAt: now,
      updatedAt: now,
      approvedAt: null,
    };
    return this.save(plan);
  }

  async revise(
    current: PlanArtifact,
    requirement: string,
    project: ProjectScan | null,
    context: ContextSummary | null,
    modelNotes: string,
  ): Promise<PlanArtifact> {
    if (!["draft", "ready", "stale"].includes(current.status)) {
      throw new Error(`当前计划状态 ${current.status} 不允许修订`);
    }
    const checkpoint = await createWorkspaceCheckpoint(
      this.workspaceRoot,
      new AbortController().signal,
    );
    const next: PlanArtifact = {
      ...structuredClone(current),
      revision: current.revision + 1,
      objective: current.objective,
      scope: inferScope(project, context, `${current.scope.join("\n")}\n${modelNotes}`),
      steps: inferSteps(modelNotes),
      revisionNotes: [
        ...current.revisionNotes.slice(-18),
        limitText(requirement, 1_000),
      ],
      workspaceFingerprint: checkpoint.fingerprint,
      workspaceFileCount: checkpoint.fileCount,
      workspaceTruncated: checkpoint.truncated,
      status: "ready",
      updatedAt: new Date().toISOString(),
      approvedAt: null,
    };
    return this.save(next);
  }

  async verifyFresh(plan: PlanArtifact): Promise<boolean> {
    const current = await createWorkspaceCheckpoint(
      this.workspaceRoot,
      new AbortController().signal,
    );
    return !current.truncated &&
      !plan.workspaceTruncated &&
      current.fileCount === plan.workspaceFileCount &&
      current.fingerprint === plan.workspaceFingerprint;
  }

  async setStatus(
    current: PlanArtifact,
    status: PlanArtifactStatus,
  ): Promise<PlanArtifact> {
    const next = {
      ...structuredClone(current),
      status,
      updatedAt: new Date().toISOString(),
      approvedAt: status === "approved"
        ? new Date().toISOString()
        : current.approvedAt,
    };
    return this.save(next);
  }
}

export function formatPlanExecutionTask(plan: PlanArtifact): string {
  return [
    `执行已批准的 CodeMuse 计划 ${plan.id}（修订 ${plan.revision}）。`,
    `目标：${plan.objective}`,
    "允许影响范围：",
    ...plan.scope.map((path) => `- ${path}`),
    "实施步骤：",
    ...plan.steps.map((step, index) =>
      `${index + 1}. ${step.title}：${step.details}`
    ),
    "验证要求：",
    ...plan.validation.map((command) => `- ${command}`),
    "必须严格按计划推进；范围或假设不成立时停止并说明，不得自行扩大范围。",
  ].join("\n");
}

function inferScope(
  project: ProjectScan | null,
  context: ContextSummary | null,
  notes: string,
): string[] {
  const projectFiles = new Set(project?.files ?? []);
  const values = new Set(context?.files.map((file) => file.path) ?? []);
  for (const match of notes.matchAll(
    /(?:^|[\s`"'(])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)(?=$|[\s`"',):])/g,
  )) {
    const path = match[1]?.replaceAll("\\", "/");
    if (path && !path.startsWith("/") && !path.includes("..")) {
      if (!projectFiles.size || projectFiles.has(path)) values.add(path);
    }
  }
  for (const keyFile of project?.keyFiles ?? []) values.add(keyFile);
  return [...values].sort().slice(0, MAX_SCOPE);
}

function inferSteps(notes: string): PlanArtifactStep[] {
  const candidates = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      /^(?:[-*]|\d+[.)])\s+/.test(line) && line.length >= 8
    )
    .map((line) => line.replace(/^(?:[-*]|\d+[.)])\s+/, "").trim())
    .filter((line) => !/^(?:风险|假设|验证|测试)[:：]?$/i.test(line))
    .filter((line) => !/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9]+$/.test(line))
    .slice(0, 10);
  const titles = candidates.length
    ? candidates
    : [
      "读取相关实现并确认影响范围",
      "实施最小且聚焦的代码修改",
      "运行相关验证并修复真实失败",
      "复核差异、需求覆盖和剩余风险",
    ];
  return titles.map((value, index) => ({
    id: `plan-${index + 1}`,
    title: limitText(value.split(/[：:]/, 1)[0] || value, 200),
    details: limitText(value, 800),
    status: "pending",
  }));
}

async function inferValidation(workspaceRoot: string): Promise<string[]> {
  try {
    const value: unknown = JSON.parse(
      await readFile(join(workspaceRoot, "package.json"), "utf8"),
    );
    if (!isRecord(value) || !isRecord(value.scripts)) return ["复核最终 Diff"];
    const names = Object.keys(value.scripts)
      .filter((name) => /(^|:)(test|typecheck|check|lint|build)(:|$)/i.test(name))
      .slice(0, 8);
    return names.length
      ? names.map((name) => `npm run ${name}`)
      : ["复核最终 Diff"];
  } catch {
    return ["复核最终 Diff"];
  }
}

function validatePlanFile(value: unknown): PlanFile {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`计划文件 schemaVersion 必须是 ${SCHEMA_VERSION}`);
  }
  const extras = Object.keys(value).filter((key) =>
    !["schemaVersion", "plan"].includes(key)
  );
  if (extras.length) throw new Error(`计划文件包含未知字段：${extras.join("、")}`);
  return {
    schemaVersion: 1,
    plan: value.plan === null ? null : validatePlan(value.plan),
  };
}

function validatePlan(value: unknown): PlanArtifact {
  if (!isRecord(value)) throw new Error("计划必须是对象");
  const statuses = new Set<PlanArtifactStatus>([
    "draft", "ready", "approved", "executing", "completed", "stale", "cancelled",
  ]);
  if (
    typeof value.id !== "string" ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1 ||
    typeof value.objective !== "string" ||
    value.objective.length > MAX_TEXT ||
    !Array.isArray(value.scope) ||
    value.scope.length > MAX_SCOPE ||
    !value.scope.every(isSafePath) ||
    !Array.isArray(value.steps) ||
    value.steps.length < 1 ||
    value.steps.length > MAX_STEPS ||
    !value.steps.every(isPlanStep) ||
    !isStringArray(value.validation, 20, 500) ||
    !isStringArray(value.risks, 20, 1_000) ||
    !isStringArray(value.assumptions, 20, 1_000) ||
    !isStringArray(value.revisionNotes, 20, 1_000) ||
    typeof value.workspaceFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/i.test(value.workspaceFingerprint) ||
    !Number.isInteger(value.workspaceFileCount) ||
    typeof value.workspaceTruncated !== "boolean" ||
    typeof value.status !== "string" ||
    !statuses.has(value.status as PlanArtifactStatus) ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.updatedAt) ||
    !(value.approvedAt === null || isIsoDate(value.approvedAt))
  ) {
    throw new Error("计划文件内容无效");
  }
  return structuredClone(value) as PlanArtifact;
}

function isPlanStep(value: unknown): value is PlanArtifactStep {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.details === "string" &&
    ["pending", "running", "completed", "failed", "cancelled"].includes(
      String(value.status),
    );
}

function isSafePath(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    !value.startsWith("/") &&
    !value.includes("..") &&
    !value.includes("\\");
}

function isStringArray(
  value: unknown,
  maximum: number,
  textMaximum: number,
): value is string[] {
  return Array.isArray(value) &&
    value.length <= maximum &&
    value.every((item) => typeof item === "string" && item.length <= textMaximum);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function limitText(value: string, maximum: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length <= maximum ? trimmed : `${trimmed.slice(0, maximum)}...`;
}
