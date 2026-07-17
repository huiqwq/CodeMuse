import { randomUUID } from "node:crypto";
import type { GoalRecord, GoalStatus } from "../types.ts";
import { WorkspaceDataFile } from "../workspace/data-file.ts";

const SCHEMA_VERSION = 1;
const MAX_GOALS = 20;
const DEFAULT_MAX_TOKENS = 200_000;
const DEFAULT_MAX_RUNS = 40;
const DEFAULT_MAX_RUNTIME_MS = 4 * 60 * 60 * 1_000;

type GoalFile = {
  schemaVersion: 1;
  goals: GoalRecord[];
};

export type GoalRunResult = {
  summary: string;
  totalTokens: number;
  runtimeMs: number;
  completed: boolean;
  verified: boolean;
  validationCommands: string[];
};

export class GoalStore {
  private readonly data: WorkspaceDataFile;

  constructor(workspaceRoot: string) {
    this.data = new WorkspaceDataFile(workspaceRoot, "goals.json");
  }

  async create(objective: string): Promise<GoalRecord> {
    const normalized = objective.replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length > 4_000) {
      throw new Error("目标必须是 1—4000 个字符");
    }
    const file = await this.loadFile();
    const active = file.goals.find((goal) =>
      goal.status === "active" ||
      goal.status === "paused" ||
      goal.status === "blocked"
    );
    if (active) {
      throw new Error(`当前工作区已有未结束目标：${active.id.slice(0, 8)}`);
    }
    const now = new Date().toISOString();
    const goal: GoalRecord = {
      id: randomUUID(),
      objective: normalized,
      successCriteria: [
        "目标要求已落实到实际代码或明确分析结论",
        "相关验证成功，或明确记录无法验证的外部阻塞",
        "最终报告包含证据、变更和剩余风险",
      ],
      tasks: [{
        id: "goal-1",
        title: normalized,
        status: "pending",
        evidence: [],
      }],
      budget: {
        maxTokens: DEFAULT_MAX_TOKENS,
        usedTokens: 0,
        maxRuns: DEFAULT_MAX_RUNS,
        usedRuns: 0,
        maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
        usedRuntimeMs: 0,
      },
      evidence: [],
      recentFailures: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    file.goals.unshift(goal);
    file.goals = file.goals.slice(0, MAX_GOALS);
    await this.saveFile(file);
    return structuredClone(goal);
  }

  async active(): Promise<GoalRecord | null> {
    const file = await this.loadFile();
    return structuredClone(
      file.goals.find((goal) =>
        goal.status === "active" ||
        goal.status === "paused" ||
        goal.status === "blocked"
      ) ?? null,
    );
  }

  async history(): Promise<GoalRecord[]> {
    return structuredClone((await this.loadFile()).goals);
  }

  async setStatus(goal: GoalRecord, status: GoalStatus): Promise<GoalRecord> {
    if (goal.status === "completed" || goal.status === "cancelled") {
      throw new Error(`目标已经处于终态：${goal.status}`);
    }
    const next: GoalRecord = {
      ...structuredClone(goal),
      status,
      updatedAt: new Date().toISOString(),
      completedAt: status === "completed"
        ? new Date().toISOString()
        : goal.completedAt,
    };
    return this.replace(next);
  }

  async recordRun(
    goal: GoalRecord,
    result: GoalRunResult,
  ): Promise<GoalRecord> {
    const next = structuredClone(goal);
    next.budget.usedRuns += 1;
    next.budget.usedTokens += Math.max(0, result.totalTokens);
    next.budget.usedRuntimeMs += Math.max(0, result.runtimeMs);
    const task = next.tasks.find((item) => item.status !== "completed");
    if (task) {
      task.status = result.completed ? "completed" : "failed";
      task.evidence.push(limit(result.summary, 1_000));
      for (const command of result.validationCommands) {
        task.evidence.push(`验证：${limit(command, 300)}`);
      }
    }
    next.evidence.push(limit(result.summary, 1_000));
    next.evidence = next.evidence.slice(-50);

    if (!result.completed) {
      next.recentFailures.push(limit(result.summary, 500));
      next.recentFailures = next.recentFailures.slice(-3);
    } else {
      next.recentFailures = [];
    }

    const budgetExhausted =
      next.budget.usedRuns >= next.budget.maxRuns ||
      next.budget.usedTokens >= next.budget.maxTokens ||
      next.budget.usedRuntimeMs >= next.budget.maxRuntimeMs;
    const repeatedFailure = next.recentFailures.length >= 2 &&
      new Set(next.recentFailures.slice(-2)).size === 1;
    if (result.completed && result.verified) {
      next.status = "completed";
      next.completedAt = new Date().toISOString();
    } else if (budgetExhausted || repeatedFailure) {
      next.status = "blocked";
    } else {
      next.status = "active";
      if (!next.tasks.some((item) => item.status === "pending")) {
        next.tasks.push({
          id: `goal-${next.tasks.length + 1}`,
          title: "复核剩余工作并继续推进目标",
          status: "pending",
          evidence: [],
        });
      }
    }
    next.updatedAt = new Date().toISOString();
    return this.replace(next);
  }

  private async replace(goal: GoalRecord): Promise<GoalRecord> {
    const file = await this.loadFile();
    const index = file.goals.findIndex((item) => item.id === goal.id);
    if (index < 0) throw new Error("目标记录不存在");
    file.goals[index] = validateGoal(goal);
    await this.saveFile(file);
    return structuredClone(file.goals[index]);
  }

  private async loadFile(): Promise<GoalFile> {
    const value = await this.data.read();
    if (value === null) return { schemaVersion: 1, goals: [] };
    if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(`目标文件 schemaVersion 必须是 ${SCHEMA_VERSION}`);
    }
    const extras = Object.keys(value).filter((key) =>
      !["schemaVersion", "goals"].includes(key)
    );
    if (extras.length) throw new Error(`目标文件包含未知字段：${extras.join("、")}`);
    if (
      !Array.isArray(value.goals) ||
      value.goals.length > MAX_GOALS
    ) {
      throw new Error("目标文件 goals 无效");
    }
    return {
      schemaVersion: 1,
      goals: value.goals.map(validateGoal),
    };
  }

  private saveFile(file: GoalFile): Promise<void> {
    return this.data.write(file);
  }
}

function validateGoal(value: unknown): GoalRecord {
  if (!isRecord(value)) throw new Error("目标记录必须是对象");
  const statuses = ["active", "paused", "completed", "blocked", "cancelled"];
  if (
    typeof value.id !== "string" ||
    typeof value.objective !== "string" ||
    value.objective.length > 4_000 ||
    !isStringArray(value.successCriteria, 20, 1_000) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length > 100 ||
    !value.tasks.every(isGoalTask) ||
    !isBudget(value.budget) ||
    !isStringArray(value.evidence, 50, 1_000) ||
    !isStringArray(value.recentFailures, 3, 500) ||
    !statuses.includes(String(value.status)) ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.updatedAt) ||
    !(value.completedAt === null || isIsoDate(value.completedAt))
  ) {
    throw new Error("目标记录内容无效");
  }
  return structuredClone(value) as GoalRecord;
}

function isGoalTask(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    ["pending", "running", "completed", "failed", "cancelled"].includes(
      String(value.status),
    ) &&
    isStringArray(value.evidence, 20, 1_000);
}

function isBudget(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [
    "maxTokens", "usedTokens", "maxRuns", "usedRuns",
    "maxRuntimeMs", "usedRuntimeMs",
  ].every((key) => Number.isInteger(value[key]) && Number(value[key]) >= 0);
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
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function limit(value: string, maximum: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum)}...`;
}
