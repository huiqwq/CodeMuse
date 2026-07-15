import type { AgentSessionState } from "../types.ts";

export type SessionStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "stopped";

export type SessionActivity = {
  at: string;
  kind: "tool" | "approval" | "notice" | "error" | "complete";
  name?: string;
  status?: string;
  summary: string;
  paths?: string[];
};

export type WorkspaceCheckpoint = {
  fingerprint: string;
  fileCount: number;
  truncated: boolean;
};

export type SessionDraft = {
  id: string;
  createdAt: string;
  task: string;
  modelName: string;
  mode: "mock" | "model";
  status: SessionStatus;
  summary: string | null;
  state: AgentSessionState;
  activities: SessionActivity[];
};

export type StoredSession = SessionDraft & {
  schemaVersion: 1;
  updatedAt: string;
  workspaceRoot: string;
  checkpoint: WorkspaceCheckpoint;
};

export type SessionHistoryItem = {
  id: string;
  createdAt: string;
  task: string;
  modelName: string;
  mode: "mock" | "model";
  status: SessionStatus;
  summary: string | null;
};
