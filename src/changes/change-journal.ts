import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createUnifiedDiff } from "./diff.ts";
import { writeTextAtomically } from "./atomic-write.ts";
import {
  resolveWorkspacePath,
  type WorkspaceContext,
} from "../context/workspace.ts";
import type {
  ApprovalHandler,
  UndoResult,
} from "../types.ts";

const MAX_FILES_PER_TASK = 20;

export type RecordedChange = {
  path: string;
  before: string;
  after: string;
  mode: number;
};

type PreparedChange = {
  change: RecordedChange;
  target: Awaited<ReturnType<typeof resolveWorkspacePath>>;
  mode: number;
};

type ChangeSet = {
  workspaceRoot: string;
  task: string;
  changes: RecordedChange[];
};

export class ChangeJournal {
  private active: ChangeSet | null = null;
  private latest: ChangeSet | null = null;

  beginTask(workspace: WorkspaceContext, task: string): void {
    this.finishTask();
    this.active = {
      workspaceRoot: workspace.realRoot,
      task,
      changes: [],
    };
  }

  assertCanRecord(workspace: WorkspaceContext, path: string): void {
    if (!this.active || this.active.workspaceRoot !== workspace.realRoot) {
      throw new Error("当前没有可记录的写入任务");
    }
    const alreadyTracked = this.active.changes.some((item) => item.path === path);
    if (!alreadyTracked && this.active.changes.length >= MAX_FILES_PER_TASK) {
      throw new Error(`单个任务最多修改 ${MAX_FILES_PER_TASK} 个文件`);
    }
  }

  record(workspace: WorkspaceContext, change: RecordedChange): void {
    this.assertCanRecord(workspace, change.path);
    const active = this.active;
    if (!active) throw new Error("当前没有可记录的写入任务");
    const existing = active.changes.find((item) => item.path === change.path);
    if (existing) {
      existing.after = change.after;
      existing.mode = change.mode;
      return;
    }

    active.changes.push(change);
  }

  finishTask(): void {
    if (this.active?.changes.length) this.latest = this.active;
    this.active = null;
  }

  async undoLatest(
    workspace: WorkspaceContext,
    signal: AbortSignal,
    requestApproval?: ApprovalHandler,
  ): Promise<UndoResult> {
    const changeSet = this.latest;
    if (!changeSet) throw new Error("当前会话没有可撤销的文件修改");
    if (changeSet.workspaceRoot !== workspace.realRoot) {
      throw new Error("最近一次修改属于另一个工作区，不能在当前项目撤销");
    }
    if (signal.aborted) throw signal.reason;

    const prepared: PreparedChange[] = [];
    for (const change of changeSet.changes) {
      const target = await resolveWorkspacePath(workspace, change.path);
      const current = await readFile(target.absolutePath, "utf8");
      if (current !== change.after) {
        throw new Error(`文件已在修改后发生变化，拒绝撤销：${change.path}`);
      }
      const info = await stat(target.absolutePath);
      prepared.push({ change, target, mode: info.mode });
    }

    const diff = prepared
      .map(({ change }) => createUnifiedDiff(change.path, change.after, change.before))
      .join("\n\n");
    const decision = requestApproval
      ? await requestApproval({
          id: randomUUID(),
          kind: "undo",
          title: "撤销最近一次任务修改",
          summary: `恢复 ${prepared.length} 个文件，任务：${changeSet.task}`,
          paths: prepared.map(({ change }) => change.path),
          diff,
        }, signal)
      : "denied";

    if (decision !== "approved") {
      return {
        undone: false,
        task: changeSet.task,
        restoredFiles: [],
        summary: "用户取消撤销",
      };
    }

    const restored: typeof prepared = [];
    try {
      for (const item of [...prepared].reverse()) {
        if (signal.aborted) throw signal.reason;
        const current = await readFile(item.target.absolutePath, "utf8");
        if (current !== item.change.after) {
          throw new Error(`文件在撤销确认期间发生变化，拒绝覆盖：${item.change.path}`);
        }
        await writeTextAtomically(
          item.target.absolutePath,
          item.change.before,
          item.mode,
        );
        restored.push(item);
      }
    } catch (error) {
      for (const item of restored.reverse()) {
        const current = await readFile(item.target.absolutePath, "utf8").catch(() => null);
        if (current !== item.change.before) continue;
        await writeTextAtomically(
          item.target.absolutePath,
          item.change.after,
          item.mode,
        ).catch(() => undefined);
      }
      throw error;
    }

    this.latest = null;
    const restoredFiles = prepared.map(({ change }) => change.path);
    return {
      undone: true,
      task: changeSet.task,
      restoredFiles,
      summary: `已撤销 ${restoredFiles.length} 个文件`,
    };
  }
}
