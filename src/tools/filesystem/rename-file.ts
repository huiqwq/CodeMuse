import { randomUUID } from "node:crypto";
import { renameFileExclusively } from "../../changes/atomic-write.ts";
import {
  resolveWorkspaceDestination,
  resolveWorkspacePath,
} from "../../context/workspace.ts";
import {
  assertNotSymbolicLink,
  assertTextFileName,
  readSafeTextFile,
} from "./text-file-safety.ts";
import {
  expectObject,
  requiredString,
} from "../registry.ts";
import type { AgentTool, ToolContext } from "../types.ts";

export type RenameFileInput = {
  fromPath: string;
  toPath: string;
};

export type RenameFileOutput = {
  fromPath: string;
  toPath: string;
  renamed: boolean;
  message: string;
};

export class RenameFileTool implements AgentTool<RenameFileInput, RenameFileOutput> {
  readonly risk = "write" as const;
  readonly definition = {
    type: "function" as const,
    function: {
      name: "rename_file",
      description:
        "重命名工作区内已读取的普通 UTF-8 文本文件。目标必须不存在，操作前会请求确认，可通过 /undo 恢复。",
      parameters: {
        type: "object",
        properties: {
          fromPath: { type: "string", description: "原文件相对路径" },
          toPath: { type: "string", description: "新文件相对路径，父目录必须存在" },
        },
        required: ["fromPath", "toPath"],
        additionalProperties: false,
      },
    },
  };

  validate(input: unknown): RenameFileInput {
    const object = expectObject(input, "rename_file");
    return {
      fromPath: requiredString(object, "fromPath"),
      toPath: requiredString(object, "toPath"),
    };
  }

  async execute(
    input: RenameFileInput,
    context: ToolContext,
  ): Promise<RenameFileOutput> {
    if (context.signal.aborted) throw context.signal.reason;
    const source = await resolveWorkspacePath(context.workspace, input.fromPath);
    const destination = await resolveWorkspaceDestination(
      context.workspace,
      input.toPath,
    );
    if (source.relativePath === destination.relativePath) {
      throw new Error("原路径和目标路径不能相同");
    }
    await assertNotSymbolicLink(context.workspace, source.relativePath);
    assertTextFileName(source.relativePath);
    assertTextFileName(destination.relativePath);
    if (!context.hasObservedFile(source.relativePath)) {
      throw new Error("重命名前必须先在当前任务中使用 read_file 读取原文件");
    }

    const original = await readSafeTextFile(
      source.absolutePath,
      source.relativePath,
    );
    context.changes.assertCanRecord(
      context.workspace,
      source.relativePath,
      destination.relativePath,
    );
    const diff = [
      `Rename: ${source.relativePath} -> ${destination.relativePath}`,
      `--- a/${source.relativePath}`,
      `+++ b/${destination.relativePath}`,
    ].join("\n");
    const decision = await context.requestApproval({
      id: randomUUID(),
      kind: "write",
      title: `确认重命名 ${source.relativePath}`,
      summary: `目标路径：${destination.relativePath}`,
      paths: [source.relativePath, destination.relativePath],
      diff,
    }, context.signal);

    if (decision !== "approved") {
      return {
        fromPath: source.relativePath,
        toPath: destination.relativePath,
        renamed: false,
        message: "用户拒绝重命名，文件保持不变",
      };
    }
    if (context.signal.aborted) throw context.signal.reason;

    const latest = await readSafeTextFile(source.absolutePath, source.relativePath);
    if (latest.content !== original.content) {
      throw new Error("文件在确认期间发生变化，拒绝重命名");
    }
    const latestDestination = await resolveWorkspaceDestination(
      context.workspace,
      destination.relativePath,
    );

    await renameFileExclusively(
      source.absolutePath,
      latestDestination.absolutePath,
    );
    try {
      context.changes.record(context.workspace, {
        kind: "rename",
        fromPath: source.relativePath,
        toPath: destination.relativePath,
        content: original.content,
        mode: original.mode,
      });
    } catch (error) {
      await renameFileExclusively(
        latestDestination.absolutePath,
        source.absolutePath,
      ).catch(() => undefined);
      throw error;
    }

    return {
      fromPath: source.relativePath,
      toPath: destination.relativePath,
      renamed: true,
      message: "文本文件已安全重命名",
    };
  }

  summarize(output: RenameFileOutput): string {
    return output.renamed
      ? `已重命名 ${output.fromPath} -> ${output.toPath}`
      : `未重命名 ${output.fromPath}（用户拒绝）`;
  }
}
