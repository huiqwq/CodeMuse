import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import {
  openWorkspace,
  type WorkspaceContext,
} from "../context/workspace.ts";
import type {
  AgentResumeContext,
  AgentSessionState,
  ContextSummary,
  ProjectScan,
  TaskPlan,
} from "../types.ts";
import { createWorkspaceCheckpoint } from "./checkpoint.ts";
import type {
  SessionActivity,
  SessionDraft,
  SessionHistoryItem,
  SessionStatus,
  StoredSession,
} from "./types.ts";

const MAX_SESSION_FILE_BYTES = 512_000;
const MAX_SESSIONS = 50;
const MAX_STORED_PROJECT_FILES = 500;
const SESSION_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/i;
const SESSION_SELECTOR_PATTERN = /^[0-9a-f-]{4,36}$/i;
const STEP_STATUSES = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
const SESSION_STATUSES = new Set<SessionStatus>([
  "completed",
  "failed",
  "cancelled",
  "stopped",
]);

export class SessionStore {
  private readonly workspaceRoot: string;
  private workspacePromise: Promise<WorkspaceContext> | null = null;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  async save(
    draft: SessionDraft,
    signal: AbortSignal,
  ): Promise<StoredSession> {
    if (!SESSION_FILE_PATTERN.test(`${draft.id}.json`)) {
      throw new Error("会话 ID 必须是合法 UUID");
    }
    if (signal.aborted) throw signal.reason;
    const workspace = await this.workspace();
    const checkpoint = await createWorkspaceCheckpoint(workspace.root, signal);
    const record: StoredSession = {
      ...draft,
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      workspaceRoot: workspace.realRoot,
      checkpoint,
      state: compactState(draft.state),
    };
    const serialized = `${JSON.stringify(record, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_SESSION_FILE_BYTES) {
      throw new Error(`会话记录超过 ${MAX_SESSION_FILE_BYTES} 字节限制`);
    }

    const directory = await this.sessionDirectory(true);
    if (!directory) throw new Error("无法创建会话目录");
    const target = join(directory, `${record.id}.json`);
    const temporary = join(
      directory,
      `.${record.id}.${process.pid}.${randomUUID()}.tmp`,
    );

    try {
      await writeFile(temporary, serialized, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }

    await this.prune(directory);
    return structuredClone(record);
  }

  async list(limit = 10): Promise<SessionHistoryItem[]> {
    const records = await this.listRecords();
    return records.slice(0, Math.max(0, Math.min(limit, MAX_SESSIONS))).map(
      (record) => ({
        id: record.id,
        createdAt: record.createdAt,
        task: record.task,
        modelName: record.modelName,
        mode: record.mode,
        status: record.status,
        summary: record.summary,
      }),
    );
  }

  async load(selector?: string): Promise<StoredSession> {
    const records = await this.listRecords();
    if (!records.length) throw new Error("当前工作区还没有历史会话");

    const value = selector?.trim();
    if (!value || value.toLowerCase() === "latest") {
      return structuredClone(records[0]);
    }
    if (!SESSION_SELECTOR_PATTERN.test(value)) {
      throw new Error("会话 ID 只能使用至少 4 位十六进制前缀");
    }

    const matches = records.filter((record) =>
      record.id.toLowerCase().startsWith(value.toLowerCase())
    );
    if (!matches.length) throw new Error(`没有找到会话：${value}`);
    if (matches.length > 1) {
      throw new Error(`会话 ID 前缀不唯一，请输入更多字符：${value}`);
    }
    return structuredClone(matches[0]);
  }

  async resume(
    selector: string | undefined,
    signal: AbortSignal,
  ): Promise<StoredSession> {
    const record = await this.load(selector);
    if (record.checkpoint.truncated) {
      throw new Error("保存会话时项目扫描被截断，无法安全验证工作区状态");
    }

    const current = await createWorkspaceCheckpoint(this.workspaceRoot, signal);
    if (
      current.truncated ||
      current.fileCount !== record.checkpoint.fileCount ||
      current.fingerprint !== record.checkpoint.fingerprint
    ) {
      throw new Error(
        "工作区自该会话保存后已经变化，拒绝恢复旧上下文；请开始新任务重新扫描",
      );
    }
    return record;
  }

  private async workspace(): Promise<WorkspaceContext> {
    this.workspacePromise ??= openWorkspace(this.workspaceRoot);
    return this.workspacePromise;
  }

  private async sessionDirectory(create: boolean): Promise<string | null> {
    const workspace = await this.workspace();
    const base = join(workspace.root, ".codemuse");

    if (!create) {
      try {
        const info = await stat(base);
        if (!info.isDirectory()) return null;
      } catch (error) {
        if (isMissingFileError(error)) return null;
        throw error;
      }
    } else {
      await mkdir(base, { recursive: true, mode: 0o700 });
    }

    const realBase = await realpath(base);
    assertInside(workspace.realRoot, realBase);
    const sessions = join(realBase, "sessions");
    if (create) {
      await mkdir(sessions, { recursive: true, mode: 0o700 });
    } else {
      try {
        const info = await stat(sessions);
        if (!info.isDirectory()) return null;
      } catch (error) {
        if (isMissingFileError(error)) return null;
        throw error;
      }
    }

    const realSessions = await realpath(sessions);
    assertInside(workspace.realRoot, realSessions);
    return realSessions;
  }

  private async listRecords(): Promise<StoredSession[]> {
    const directory = await this.sessionDirectory(false);
    if (!directory) return [];

    const entries = await readdir(directory, { withFileTypes: true });
    const records: StoredSession[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !SESSION_FILE_PATTERN.test(entry.name)) continue;
      const record = await readStoredSession(join(directory, entry.name));
      if (record) records.push(record);
    }
    return records.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }

  private async prune(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && SESSION_FILE_PATTERN.test(entry.name));
    const files = await Promise.all(entries.map(async (entry) => ({
      path: join(directory, entry.name),
      modifiedAt: (await stat(join(directory, entry.name))).mtimeMs,
    })));
    files.sort((left, right) => right.modifiedAt - left.modifiedAt);
    for (const file of files.slice(MAX_SESSIONS)) {
      await rm(file.path, { force: true });
    }
  }
}

export function createAgentResumeContext(
  record: StoredSession,
): AgentResumeContext {
  return {
    sessionId: record.id,
    createdAt: record.createdAt,
    priorTask: record.task,
    status: record.status,
    summary: record.summary,
    priorPlan: record.state.plan?.steps.map((step) => ({ ...step })) ?? [],
    recentActivities: record.activities.slice(-10).map(formatActivity),
  };
}

function formatActivity(activity: SessionActivity): string {
  const parts = [
    activity.kind,
    activity.name,
    activity.status,
    activity.summary.replace(/\s+/g, " ").trim(),
  ].filter(Boolean);
  return parts.join(" | ").slice(0, 400);
}

function compactState(state: AgentSessionState): AgentSessionState {
  const result = structuredClone(state);
  if (
    result.project &&
    result.project.files.length > MAX_STORED_PROJECT_FILES
  ) {
    result.project.files = result.project.files.slice(
      0,
      MAX_STORED_PROJECT_FILES,
    );
    result.project.truncated = true;
  }
  return result;
}

async function readStoredSession(path: string): Promise<StoredSession | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_SESSION_FILE_BYTES) return null;
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return isStoredSession(value) ? value : null;
  } catch {
    return null;
  }
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    SESSION_FILE_PATTERN.test(`${value.id}.json`) &&
    isIsoDate(value.createdAt) &&
    isIsoDate(value.updatedAt) &&
    typeof value.workspaceRoot === "string" &&
    typeof value.task === "string" && value.task.length <= 4_000 &&
    typeof value.modelName === "string" && value.modelName.length <= 200 &&
    (value.mode === "mock" || value.mode === "model") &&
    typeof value.status === "string" &&
    SESSION_STATUSES.has(value.status as SessionStatus) &&
    (value.summary === null ||
      (typeof value.summary === "string" && value.summary.length <= 2_000)) &&
    isWorkspaceCheckpoint(value.checkpoint) &&
    isAgentSessionState(value.state) &&
    Array.isArray(value.activities) &&
    value.activities.length <= 100 &&
    value.activities.every(isSessionActivity)
  );
}

function isWorkspaceCheckpoint(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.fingerprint === "string" &&
    /^[0-9a-f]{64}$/i.test(value.fingerprint) &&
    isNonNegativeInteger(value.fileCount) &&
    typeof value.truncated === "boolean";
}

function isAgentSessionState(value: unknown): value is AgentSessionState {
  return isRecord(value) &&
    (value.project === null || isProjectScan(value.project)) &&
    (value.plan === null || isTaskPlan(value.plan)) &&
    (value.context === null || isContextSummary(value.context));
}

function isProjectScan(value: unknown): value is ProjectScan {
  return isRecord(value) &&
    typeof value.projectName === "string" &&
    isStringArray(value.projectTypes, 50) &&
    isStringArray(value.languages, 100) &&
    isStringArray(value.frameworks, 100) &&
    (value.packageManager === null || typeof value.packageManager === "string") &&
    isNonNegativeInteger(value.fileCount) &&
    isStringArray(value.files, MAX_STORED_PROJECT_FILES) &&
    isStringArray(value.keyFiles, 100) &&
    typeof value.truncated === "boolean";
}

function isTaskPlan(value: unknown): value is TaskPlan {
  return isRecord(value) &&
    typeof value.task === "string" &&
    Array.isArray(value.steps) &&
    value.steps.length <= 20 &&
    value.steps.every((step) =>
      isRecord(step) &&
      typeof step.id === "string" &&
      typeof step.title === "string" &&
      typeof step.status === "string" &&
      STEP_STATUSES.has(step.status)
    );
}

function isContextSummary(value: unknown): value is ContextSummary {
  return isRecord(value) &&
    isFiniteNumber(value.budgetTokens) &&
    isFiniteNumber(value.estimatedTokens) &&
    isNonNegativeInteger(value.omittedFiles) &&
    typeof value.truncated === "boolean" &&
    Array.isArray(value.files) &&
    value.files.length <= 100 &&
    value.files.every((file) =>
      isRecord(file) &&
      typeof file.path === "string" &&
      isFiniteNumber(file.score) &&
      isFiniteNumber(file.estimatedTokens) &&
      typeof file.truncated === "boolean"
    );
}

function isSessionActivity(value: unknown): value is SessionActivity {
  return isRecord(value) &&
    isIsoDate(value.at) &&
    typeof value.kind === "string" &&
    ["tool", "approval", "notice", "usage", "error", "complete"].includes(value.kind) &&
    (value.name === undefined || typeof value.name === "string") &&
    (value.status === undefined || typeof value.status === "string") &&
    typeof value.summary === "string" && value.summary.length <= 2_000 &&
    (
      value.paths === undefined ||
      isStringArray(value.paths, 20)
    );
}

function isStringArray(
  value: unknown,
  maximum: number,
  maximumItemLength = 1_000,
): value is string[] {
  return Array.isArray(value) &&
    value.length <= maximum &&
    value.every((item) =>
      typeof item === "string" && item.length <= maximumItemLength
    );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT";
}

function assertInside(root: string, candidate: string): void {
  const value = relative(root, candidate);
  if (
    value === "" ||
    (
      value !== ".." &&
      !value.startsWith(`..\\`) &&
      !value.startsWith("../") &&
      !isAbsolute(value)
    )
  ) {
    return;
  }
  throw new Error("会话目录位于工作区之外，拒绝访问");
}
