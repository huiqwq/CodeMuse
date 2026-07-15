import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { createTextFileExclusive } from "../../changes/atomic-write.ts";
import { createUnifiedDiff } from "../../changes/diff.ts";
import { resolveWorkspacePath } from "../../context/workspace.ts";
import {
  assertNotSymbolicLink,
  limitApprovalDiff,
  readSafeTextFile,
} from "./text-file-safety.ts";
import {
  expectObject,
  requiredString,
} from "../registry.ts";
import type { AgentTool, ToolContext } from "../types.ts";

export type DeleteFileInput = { path: string };

export type DeleteFileOutput = {
  path: string;
  deleted: boolean;
  diff: string;
  message: string;
};

export class DeleteFileTool implements AgentTool<DeleteFileInput, DeleteFileOutput> {
  readonly risk = "write" as const;
  readonly definition = {
    type: "function" as const,
    function: {
      name: "delete_file",
      description:
        "删除工作区内已读取的普通 UTF-8 文本文件。删除前会展示 Diff 并请求确认，可通过 /undo 恢复。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "工作区内的文件相对路径" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  };

  validate(input: unknown): DeleteFileInput {
    const object = expectObject(input, "delete_file");
    return { path: requiredString(object, "path") };
  }

  async execute(
    input: DeleteFileInput,
    context: ToolContext,
  ): Promise<DeleteFileOutput> {
    if (context.signal.aborted) throw context.signal.reason;
    const target = await resolveWorkspacePath(context.workspace, input.path);
    await assertNotSymbolicLink(context.workspace, target.relativePath);
    if (!context.hasObservedFile(target.relativePath)) {
      throw new Error("删除前必须先在当前任务中使用 read_file 读取目标文件");
    }
    const original = await readSafeTextFile(
      target.absolutePath,
      target.relativePath,
    );
    context.changes.assertCanRecord(context.workspace, target.relativePath);

    const rawDiff = createUnifiedDiff(target.relativePath, original.content, "") ||
      `Delete empty file: ${target.relativePath}`;
    const diff = limitApprovalDiff(rawDiff);
    const decision = await context.requestApproval({
      id: randomUUID(),
      kind: "write",
      title: `确认删除 ${target.relativePath}`,
      summary: "删除 1 个 UTF-8 文本文件，可通过 /undo 恢复",
      paths: [target.relativePath],
      diff,
    }, context.signal);

    if (decision !== "approved") {
      return {
        path: target.relativePath,
        deleted: false,
        diff,
        message: "用户拒绝删除，文件保持不变",
      };
    }
    if (context.signal.aborted) throw context.signal.reason;

    const latest = await readSafeTextFile(target.absolutePath, target.relativePath);
    if (latest.content !== original.content) {
      throw new Error("文件在确认期间发生变化，拒绝删除");
    }

    await unlink(target.absolutePath);
    try {
      context.changes.record(context.workspace, {
        kind: "delete",
        path: target.relativePath,
        before: original.content,
        mode: original.mode,
      });
    } catch (error) {
      await createTextFileExclusive(
        target.absolutePath,
        original.content,
        original.mode,
      ).catch(() => undefined);
      throw error;
    }

    return {
      path: target.relativePath,
      deleted: true,
      diff,
      message: "文本文件已安全删除",
    };
  }

  summarize(output: DeleteFileOutput): string {
    return output.deleted
      ? `已删除 ${output.path}`
      : `未删除 ${output.path}（用户拒绝）`;
  }
}
