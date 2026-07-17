import { WorkspaceDataFile } from "../workspace/data-file.ts";

const MAX_EVENTS = 200;

export type DiagnosticEvent = {
  at: string;
  level: "error" | "info";
  category: string;
  message: string;
};

export class DiagnosticLogger {
  private readonly data: WorkspaceDataFile;
  private readonly level: "off" | "error" | "info";

  constructor(
    workspaceRoot: string,
    level: "off" | "error" | "info" = "error",
  ) {
    this.data = new WorkspaceDataFile(
      workspaceRoot,
      "diagnostics.json",
      256_000,
    );
    this.level = level;
  }

  async record(
    level: "error" | "info",
    category: string,
    message: string,
  ): Promise<void> {
    if (
      this.level === "off" ||
      this.level === "error" && level === "info"
    ) return;
    const value = await this.data.read().catch(() => null);
    const events = isRecord(value) &&
        value.schemaVersion === 1 &&
        Array.isArray(value.events)
      ? value.events.filter(isDiagnosticEvent)
      : [];
    events.push({
      at: new Date().toISOString(),
      level,
      category: sanitize(category, 100),
      message: sanitize(message, 500),
    });
    await this.data.write({
      schemaVersion: 1,
      events: events.slice(-MAX_EVENTS),
    });
  }

  get path(): string {
    return this.data.path;
  }
}

function isDiagnosticEvent(value: unknown): value is DiagnosticEvent {
  return isRecord(value) &&
    typeof value.at === "string" &&
    (value.level === "error" || value.level === "info") &&
    typeof value.category === "string" &&
    typeof value.message === "string";
}

function sanitize(value: string, maximum: number): string {
  const result = value
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+)\b/gi,
      "[REDACTED]",
    )
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return result.length <= maximum ? result : `${result.slice(0, maximum)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
