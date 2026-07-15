import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  AgentSessionState,
  ApprovalDecision,
  ApprovalRequest,
} from "../types.ts";
import type {
  SessionActivity,
  SessionDraft,
  SessionStatus,
} from "./types.ts";

const MAX_ACTIVITIES = 100;
const MAX_TEXT_LENGTH = 2_000;

export class SessionRecorder {
  readonly id = randomUUID();
  readonly createdAt = new Date().toISOString();

  private readonly task: string;
  private readonly modelName: string;
  private readonly mode: "mock" | "model";
  private readonly secrets: string[];
  private readonly activities: SessionActivity[] = [];
  private status: SessionStatus | null = null;
  private summary: string | null = null;

  constructor(
    task: string,
    modelName: string,
    mode: "mock" | "model",
    secrets: Array<string | undefined> = [],
  ) {
    this.secrets = secrets.filter((value): value is string =>
      Boolean(value && value.length >= 6)
    );
    this.task = this.clean(task, 4_000);
    this.modelName = this.clean(modelName, 200);
    this.mode = mode;
  }

  recordEvent(event: AgentEvent): void {
    switch (event.type) {
      case "tool-complete":
        this.addActivity({
          at: now(),
          kind: "tool",
          name: this.clean(event.name, 100),
          status: "completed",
          summary: this.clean(event.summary),
        });
        break;
      case "tool-failed":
        this.addActivity({
          at: now(),
          kind: "tool",
          name: this.clean(event.name, 100),
          status: "failed",
          summary: this.clean(event.error),
        });
        break;
      case "model-usage":
        this.addActivity({
          at: now(),
          kind: "usage",
          name: this.clean(event.model, 200),
          summary: `输入 ${event.usage.promptTokens}，输出 ${event.usage.completionTokens}，合计 ${event.usage.totalTokens} Tokens`,
        });
        break;
      case "notice":
        this.addActivity({
          at: now(),
          kind: "notice",
          summary: this.clean(event.message),
        });
        if (event.message.includes("任务已取消")) {
          this.status = "cancelled";
          this.summary = this.clean(event.message);
        }
        break;
      case "error":
        this.status = "failed";
        this.summary = this.clean(event.message);
        this.addActivity({
          at: now(),
          kind: "error",
          summary: this.clean(event.message),
        });
        break;
      case "complete": {
        const summary = this.clean(event.summary ?? "任务完成");
        this.status = summary.includes("自动修复已停止")
          ? "stopped"
          : "completed";
        this.summary = summary;
        this.addActivity({
          at: now(),
          kind: "complete",
          status: this.status,
          summary,
        });
        break;
      }
    }
  }

  recordApproval(
    request: ApprovalRequest,
    decision: ApprovalDecision,
  ): void {
    this.addActivity({
      at: now(),
      kind: "approval",
      name: request.kind,
      status: decision,
      summary: this.clean(`${request.title}：${request.summary}`),
      paths: request.paths
        .slice(0, 20)
        .map((path) => this.clean(path, 500)),
    });
  }

  recordUnhandledError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.status = "failed";
    this.summary = this.clean(message);
    this.addActivity({
      at: now(),
      kind: "error",
      summary: this.clean(message),
    });
  }

  toDraft(
    state: AgentSessionState,
    wasAborted: boolean,
  ): SessionDraft {
    const status = this.status ?? (wasAborted ? "cancelled" : "completed");
    return {
      id: this.id,
      createdAt: this.createdAt,
      task: this.task,
      modelName: this.modelName,
      mode: this.mode,
      status,
      summary: this.summary ?? (status === "cancelled" ? "任务已取消" : "任务结束"),
      state: this.cleanState(state),
      activities: structuredClone(this.activities),
    };
  }

  private cleanState(state: AgentSessionState): AgentSessionState {
    const result = structuredClone(state);
    if (result.project) {
      result.project.projectName = this.clean(result.project.projectName, 500);
      result.project.projectTypes = result.project.projectTypes.map((value) =>
        this.clean(value, 200)
      );
      result.project.languages = result.project.languages.map((value) =>
        this.clean(value, 200)
      );
      result.project.frameworks = result.project.frameworks.map((value) =>
        this.clean(value, 200)
      );
      if (result.project.packageManager) {
        result.project.packageManager = this.clean(
          result.project.packageManager,
          200,
        );
      }
      result.project.files = result.project.files.map((value) =>
        this.clean(value, 500)
      );
      result.project.keyFiles = result.project.keyFiles.map((value) =>
        this.clean(value, 500)
      );
    }
    if (result.plan) {
      result.plan.task = this.clean(result.plan.task, 4_000);
      result.plan.steps = result.plan.steps.map((step) => ({
        ...step,
        id: this.clean(step.id, 100),
        title: this.clean(step.title, 500),
      }));
    }
    if (result.context) {
      result.context.files = result.context.files.map((file) => ({
        ...file,
        path: this.clean(file.path, 500),
      }));
    }
    return result;
  }

  private addActivity(activity: SessionActivity): void {
    if (this.activities.length >= MAX_ACTIVITIES) return;
    this.activities.push(activity);
  }

  private clean(value: string, maximum = MAX_TEXT_LENGTH): string {
    let result = value;
    for (const secret of this.secrets) {
      result = result.split(secret).join("[REDACTED]");
    }
    result = result
      .replace(
        /(CODEMUSE_API_KEY\s*[:=]\s*)[^\s"'\x60]+/gi,
        "$1[REDACTED]",
      )
      .replace(
        /(authorization\s*[:=]\s*bearer\s+)[^\s"'\x60]+/gi,
        "$1[REDACTED]",
      )
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
    return result.length <= maximum
      ? result
      : `${result.slice(0, maximum)}...`;
  }
}

function now(): string {
  return new Date().toISOString();
}
