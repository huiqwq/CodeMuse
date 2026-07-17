import type { ApprovalMode } from "../types.ts";
import { WorkspaceDataFile } from "../workspace/data-file.ts";

const SCHEMA_VERSION = 1;

export type WorkspaceSettings = {
  approvalMode: ApprovalMode;
  logLevel: "off" | "error" | "info";
};

export class WorkspaceSettingsStore {
  private readonly data: WorkspaceDataFile;

  constructor(workspaceRoot: string) {
    this.data = new WorkspaceDataFile(workspaceRoot, "settings.json", 32_000);
  }

  async load(): Promise<WorkspaceSettings> {
    const value = await this.data.read();
    if (value === null) {
      return { approvalMode: "strict", logLevel: "error" };
    }
    if (
      !isRecord(value) ||
      value.schemaVersion !== SCHEMA_VERSION ||
      (value.approvalMode !== "strict" &&
        value.approvalMode !== "plan-scoped") ||
      !["off", "error", "info"].includes(String(value.logLevel))
    ) {
      throw new Error("工作区设置文件无效");
    }
    const extras = Object.keys(value).filter((key) =>
      !["schemaVersion", "approvalMode", "logLevel"].includes(key)
    );
    if (extras.length) throw new Error(`设置文件包含未知字段：${extras.join("、")}`);
    return {
      approvalMode: value.approvalMode,
      logLevel: value.logLevel as WorkspaceSettings["logLevel"],
    };
  }

  async save(settings: WorkspaceSettings): Promise<void> {
    await this.data.write({
      schemaVersion: SCHEMA_VERSION,
      ...settings,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
