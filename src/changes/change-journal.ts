import { randomUUID } from "node:crypto";
import { readFile, stat, unlink } from "node:fs/promises";
import {
  createTextFileExclusive,
  renameFileExclusively,
  writeTextAtomically,
} from "./atomic-write.ts";
import { createUnifiedDiff } from "./diff.ts";
import {
  resolveWorkspaceDestination,
  resolveWorkspacePath,
  type WorkspaceContext,
} from "../context/workspace.ts";
import type {
  ApprovalHandler,
  UndoResult,
} from "../types.ts";

const MAX_FILES_PER_TASK = 20;
const MAX_OPERATIONS_PER_TASK = 40;

export type ModifyChange = {
  kind: "modify";
  path: string;
  before: string;
  after: string;
  mode: number;
};

export type CreateChange = {
  kind: "create";
  path: string;
  after: string;
  mode: number;
};

export type DeleteChange = {
  kind: "delete";
  path: string;
  before: string;
  mode: number;
};

export type RenameChange = {
  kind: "rename";
  fromPath: string;
  toPath: string;
  content: string;
  mode: number;
};

export type RecordedChange =
  | ModifyChange
  | CreateChange
  | DeleteChange
  | RenameChange;

export type ChangeSummary = {
  totalOperations: number;
  createdFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
  renamedFiles: Array<{ fromPath: string; toPath: string }>;
  changedPaths: string[];
};

type ChangeSet = {
  workspaceRoot: string;
  task: string;
  changes: RecordedChange[];
};

type ExistingFile = {
  exists: true;
  absolutePath: string;
  relativePath: string;
  content: string;
  mode: number;
};

type MissingFile = {
  exists: false;
  absolutePath: string;
  relativePath: string;
};

type FileState = ExistingFile | MissingFile;

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

  assertCanRecord(workspace: WorkspaceContext, ...paths: string[]): void {
    const active = this.requireActive(workspace);
    if (active.changes.length >= MAX_OPERATIONS_PER_TASK) {
      throw new Error(`单个任务最多执行 ${MAX_OPERATIONS_PER_TASK} 次文件修改操作`);
    }

    const tracked = new Set(active.changes.flatMap(pathsForChange));
    for (const path of paths) tracked.add(path);
    if (tracked.size > MAX_FILES_PER_TASK) {
      throw new Error(`单个任务最多涉及 ${MAX_FILES_PER_TASK} 个文件`);
    }
  }

  record(workspace: WorkspaceContext, change: RecordedChange): void {
    const paths = pathsForChange(change);
    this.assertCanRecord(workspace, ...paths);
    this.requireActive(workspace).changes.push(change);
  }

  activeSummary(): ChangeSummary {
    return summarizeChanges(this.active?.changes ?? []);
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

    await assertFinalState(workspace, changeSet.changes);
    const summary = summarizeChanges(changeSet.changes);
    const decision = requestApproval
      ? await requestApproval({
          id: randomUUID(),
          kind: "undo",
          title: "撤销最近一次任务修改",
          summary: `撤销 ${summary.totalOperations} 次操作，任务：${changeSet.task}`,
          paths: summary.changedPaths,
          diff: changeSet.changes
            .map(formatInverseChange)
            .reverse()
            .join("\n\n"),
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

    const undone: RecordedChange[] = [];
    try {
      for (const change of [...changeSet.changes].reverse()) {
        if (signal.aborted) throw signal.reason;
        await applyInverse(workspace, change);
        undone.push(change);
      }
    } catch (error) {
      for (const change of undone.reverse()) {
        await applyForward(workspace, change).catch(() => undefined);
      }
      throw error;
    }

    this.latest = null;
    return {
      undone: true,
      task: changeSet.task,
      restoredFiles: summary.changedPaths,
      summary: `已撤销 ${summary.totalOperations} 次文件操作`,
    };
  }

  private requireActive(workspace: WorkspaceContext): ChangeSet {
    if (!this.active || this.active.workspaceRoot !== workspace.realRoot) {
      throw new Error("当前没有可记录的写入任务");
    }
    return this.active;
  }
}

export function formatChangeSummary(summary: ChangeSummary): string {
  if (!summary.totalOperations) return "本次 Agent 未修改文件";
  const parts = [
    summary.createdFiles.length ? `新建 ${summary.createdFiles.length}` : "",
    summary.modifiedFiles.length ? `修改 ${summary.modifiedFiles.length}` : "",
    summary.renamedFiles.length ? `重命名 ${summary.renamedFiles.length}` : "",
    summary.deletedFiles.length ? `删除 ${summary.deletedFiles.length}` : "",
  ].filter(Boolean);
  return `本次 Agent 文件操作：${parts.join("、")}；涉及 ${summary.changedPaths.join("、")}`;
}

function summarizeChanges(changes: RecordedChange[]): ChangeSummary {
  const createdFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const deletedFiles: string[] = [];
  const renamedFiles: Array<{ fromPath: string; toPath: string }> = [];
  const changedPaths = new Set<string>();

  for (const change of changes) {
    switch (change.kind) {
      case "create":
        createdFiles.push(change.path);
        changedPaths.add(change.path);
        break;
      case "modify":
        modifiedFiles.push(change.path);
        changedPaths.add(change.path);
        break;
      case "delete":
        deletedFiles.push(change.path);
        changedPaths.add(change.path);
        break;
      case "rename":
        renamedFiles.push({
          fromPath: change.fromPath,
          toPath: change.toPath,
        });
        changedPaths.add(change.fromPath);
        changedPaths.add(change.toPath);
        break;
    }
  }

  return {
    totalOperations: changes.length,
    createdFiles,
    modifiedFiles,
    deletedFiles,
    renamedFiles,
    changedPaths: [...changedPaths],
  };
}

async function assertFinalState(
  workspace: WorkspaceContext,
  changes: RecordedChange[],
): Promise<void> {
  const expected = new Map<string, string | null>();
  for (const change of changes) {
    switch (change.kind) {
      case "modify":
      case "create":
        expected.set(change.path, change.after);
        break;
      case "delete":
        expected.set(change.path, null);
        break;
      case "rename":
        expected.set(change.fromPath, null);
        expected.set(change.toPath, change.content);
        break;
    }
  }

  for (const [path, content] of expected) {
    const current = await inspectFile(workspace, path);
    if (content === null) {
      if (current.exists) {
        throw new Error(`文件已在修改后发生变化，拒绝撤销：${path}`);
      }
    } else if (!current.exists || current.content !== content) {
      throw new Error(`文件已在修改后发生变化，拒绝撤销：${path}`);
    }
  }
}

async function applyInverse(
  workspace: WorkspaceContext,
  change: RecordedChange,
): Promise<void> {
  switch (change.kind) {
    case "modify": {
      const current = await expectExisting(workspace, change.path, change.after);
      await writeTextAtomically(current.absolutePath, change.before, current.mode);
      return;
    }
    case "create": {
      const current = await expectExisting(workspace, change.path, change.after);
      await unlink(current.absolutePath);
      return;
    }
    case "delete": {
      const target = await expectMissing(workspace, change.path);
      await createTextFileExclusive(target.absolutePath, change.before, change.mode);
      return;
    }
    case "rename": {
      const source = await expectMissing(workspace, change.fromPath);
      const target = await expectExisting(workspace, change.toPath, change.content);
      await renameFileExclusively(target.absolutePath, source.absolutePath);
      return;
    }
  }
}

async function applyForward(
  workspace: WorkspaceContext,
  change: RecordedChange,
): Promise<void> {
  switch (change.kind) {
    case "modify": {
      const current = await expectExisting(workspace, change.path, change.before);
      await writeTextAtomically(current.absolutePath, change.after, current.mode);
      return;
    }
    case "create": {
      const target = await expectMissing(workspace, change.path);
      await createTextFileExclusive(target.absolutePath, change.after, change.mode);
      return;
    }
    case "delete": {
      const current = await expectExisting(workspace, change.path, change.before);
      await unlink(current.absolutePath);
      return;
    }
    case "rename": {
      const source = await expectExisting(workspace, change.fromPath, change.content);
      const target = await expectMissing(workspace, change.toPath);
      await renameFileExclusively(source.absolutePath, target.absolutePath);
      return;
    }
  }
}

async function expectExisting(
  workspace: WorkspaceContext,
  path: string,
  content: string,
): Promise<ExistingFile> {
  const current = await inspectFile(workspace, path);
  if (!current.exists || current.content !== content) {
    throw new Error(`文件状态与记录不一致，拒绝操作：${path}`);
  }
  return current;
}

async function expectMissing(
  workspace: WorkspaceContext,
  path: string,
): Promise<MissingFile> {
  const current = await inspectFile(workspace, path);
  if (current.exists) {
    throw new Error(`目标路径已被占用，拒绝操作：${path}`);
  }
  return current;
}

async function inspectFile(
  workspace: WorkspaceContext,
  path: string,
): Promise<FileState> {
  try {
    const target = await resolveWorkspacePath(workspace, path);
    const info = await stat(target.absolutePath);
    if (!info.isFile()) throw new Error(`只支持普通文件：${path}`);
    return {
      exists: true,
      ...target,
      content: decodeUtf8(await readFile(target.absolutePath)),
      mode: info.mode,
    };
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
    const target = await resolveWorkspaceDestination(workspace, path);
    return { exists: false, ...target };
  }
}

function formatInverseChange(change: RecordedChange): string {
  switch (change.kind) {
    case "modify":
      return createUnifiedDiff(change.path, change.after, change.before);
    case "create":
      return createUnifiedDiff(change.path, change.after, "") ||
        `Delete empty file: ${change.path}`;
    case "delete":
      return createUnifiedDiff(change.path, "", change.before) ||
        `Restore empty file: ${change.path}`;
    case "rename":
      return [
        `Rename: ${change.toPath} -> ${change.fromPath}`,
        `--- a/${change.toPath}`,
        `+++ b/${change.fromPath}`,
      ].join("\n");
  }
}

function pathsForChange(change: RecordedChange): string[] {
  return change.kind === "rename"
    ? [change.fromPath, change.toPath]
    : [change.path];
}

function decodeUtf8(buffer: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("文件不是有效的 UTF-8 文本");
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
