import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { createTextFileExclusive } from "../../changes/atomic-write.ts";
import { createUnifiedDiff } from "../../changes/diff.ts";
import { resolveWorkspaceDestination } from "../../context/workspace.ts";
import {
  assertTextFileName,
  decodeUtf8,
  limitApprovalDiff,
  validateNewText,
} from "./text-file-safety.ts";
import {
  expectObject,
  requiredString,
  requiredStringValue,
} from "../registry.ts";
import type { AgentTool, ToolContext } from "../types.ts";

export type CreateFileInput = {
  path: string;
  content: string;
};

export type CreateFileOutput = {
  path: string;
  created: boolean;
  diff: string;
  message: string;
};

export class CreateFileTool implements AgentTool<CreateFileInput, CreateFileOutput> {
  readonly risk = "write" as const;
  readonly definition = {
    type: "function" as const,
    function: {
      name: "create_file",
      description:
        "在已存在的工作区目录中创建新的 UTF-8 文本文件。目标必须不存在，写入前会展示 Diff 并请求确认。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "工作区内的新文件相对路径" },
          content: { type: "string", description: "新文件的完整 UTF-8 文本内容" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  };

  validate(input: unknown): CreateFileInput {
    const object = expectObject(input, "create_file");
    return {
      path: requiredString(object, "path"),
      content: requiredStringValue(object, "content"),
    };
  }

  async execute(
    input: CreateFileInput,
    context: ToolContext,
  ): Promise<CreateFileOutput> {
    if (context.signal.aborted) throw context.signal.reason;
    validateNewText(input.content);
    const target = await resolveWorkspaceDestination(context.workspace, input.path);
    assertTextFileName(target.relativePath);
    context.changes.assertCanRecord(context.workspace, target.relativePath);

    const rawDiff = createUnifiedDiff(target.relativePath, "", input.content) ||
      `Create empty file: ${target.relativePath}`;
    const diff = limitApprovalDiff(rawDiff);
    const decision = await context.requestApproval({
      id: randomUUID(),
      kind: "write",
      title: `确认创建 ${target.relativePath}`,
      summary: `创建 UTF-8 文本文件，共 ${Buffer.byteLength(input.content, "utf8")} 字节`,
      paths: [target.relativePath],
      diff,
    }, context.signal);

    if (decision !== "approved") {
      return {
        path: target.relativePath,
        created: false,
        diff,
        message: "用户拒绝创建，文件未写入",
      };
    }
    if (context.signal.aborted) throw context.signal.reason;

    const latestTarget = await resolveWorkspaceDestination(
      context.workspace,
      target.relativePath,
    );
    await createTextFileExclusive(latestTarget.absolutePath, input.content);
    try {
      context.changes.record(context.workspace, {
        kind: "create",
        path: target.relativePath,
        after: input.content,
        mode: 0o666,
      });
    } catch (error) {
      const current = await readFile(latestTarget.absolutePath)
        .then(decodeUtf8)
        .catch(() => null);
      if (current === input.content) {
        await unlink(latestTarget.absolutePath).catch(() => undefined);
      }
      throw error;
    }

    return {
      path: target.relativePath,
      created: true,
      diff,
      message: "文本文件已安全创建",
    };
  }

  summarize(output: CreateFileOutput): string {
    return output.created
      ? `已创建 ${output.path}`
      : `未创建 ${output.path}（用户拒绝）`;
  }
}
