import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createUnifiedDiff } from "../../changes/diff.ts";
import { writeTextAtomically } from "../../changes/atomic-write.ts";
import {
  containsBinaryBytes,
  isBinaryFileName,
} from "../../context/ignore-rules.ts";
import { resolveWorkspacePath } from "../../context/workspace.ts";
import {
  expectObject,
  requiredString,
  requiredStringValue,
} from "../registry.ts";
import type { AgentTool, ToolContext } from "../types.ts";

const MAX_FILE_BYTES = 1_000_000;
const MAX_PATCH_TEXT = 50_000;

export type ApplyPatchInput = {
  path: string;
  oldText: string;
  newText: string;
};

export type ApplyPatchOutput = {
  path: string;
  applied: boolean;
  diff: string;
  message: string;
};

export class ApplyPatchTool implements AgentTool<ApplyPatchInput, ApplyPatchOutput> {
  readonly risk = "write" as const;
  readonly definition = {
    type: "function" as const,
    function: {
      name: "apply_patch",
      description:
        "精确替换工作区文件中的唯一旧片段。写入前会向用户展示 Diff 并请求确认；不得用于整文件覆盖。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "工作区内的相对文件路径" },
          oldText: {
            type: "string",
            description: "必须在文件中唯一出现的原始代码片段，不包含 read_file 的行号",
          },
          newText: {
            type: "string",
            description: "替换后的代码片段；允许空字符串以删除局部片段",
          },
        },
        required: ["path", "oldText", "newText"],
        additionalProperties: false,
      },
    },
  };

  validate(input: unknown): ApplyPatchInput {
    const object = expectObject(input, "apply_patch");
    const oldText = requiredString(object, "oldText");
    const newText = requiredStringValue(object, "newText");
    if (oldText.length > MAX_PATCH_TEXT || newText.length > MAX_PATCH_TEXT) {
      throw new Error(`补丁片段不能超过 ${MAX_PATCH_TEXT} 个字符`);
    }
    return {
      path: requiredString(object, "path"),
      oldText,
      newText,
    };
  }

  async execute(
    input: ApplyPatchInput,
    context: ToolContext,
  ): Promise<ApplyPatchOutput> {
    if (context.signal.aborted) throw context.signal.reason;
    const target = await resolveWorkspacePath(context.workspace, input.path);
    if (isBinaryFileName(target.relativePath)) throw new Error("拒绝修改二进制文件");
    if (!context.hasObservedFile(target.relativePath)) {
      throw new Error("修改前必须先在当前任务中使用 read_file 读取目标文件");
    }

    const info = await stat(target.absolutePath);
    if (!info.isFile()) throw new Error("apply_patch 只能修改普通文件");
    if (info.size > MAX_FILE_BYTES) {
      throw new Error(`文件超过 ${MAX_FILE_BYTES} 字节限制`);
    }

    const buffer = await readFile(target.absolutePath);
    if (containsBinaryBytes(buffer)) throw new Error("文件包含二进制内容");
    const original = decodeUtf8(buffer);
    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    const oldText = normalizeNewlines(input.oldText, eol);
    const newText = normalizeNewlines(input.newText, eol);
    const occurrences = countOccurrences(original, oldText);

    if (occurrences === 0) throw new Error("旧片段未在目标文件中找到");
    if (occurrences > 1) {
      throw new Error(`旧片段在文件中出现 ${occurrences} 次，必须提供更精确的唯一片段`);
    }
    const originalWithoutFinalEol = original.endsWith(eol)
      ? original.slice(0, -eol.length)
      : original;
    if (oldText === original || oldText === originalWithoutFinalEol) {
      throw new Error("拒绝整文件覆盖，请提交局部补丁");
    }
    if (oldText === newText) throw new Error("补丁没有产生任何变化");

    const updated = original.replace(oldText, newText);
    if (Buffer.byteLength(updated, "utf8") > MAX_FILE_BYTES) {
      throw new Error(`修改后的文件超过 ${MAX_FILE_BYTES} 字节限制`);
    }
    context.changes.assertCanRecord(context.workspace, target.relativePath);

    const diff = createUnifiedDiff(target.relativePath, original, updated);
    const decision = await context.requestApproval({
      id: randomUUID(),
      kind: "write",
      title: `确认修改 ${target.relativePath}`,
      summary: "应用 1 个精确局部补丁",
      paths: [target.relativePath],
      diff,
    }, context.signal);

    if (decision !== "approved") {
      return {
        path: target.relativePath,
        applied: false,
        diff,
        message: "用户拒绝写入，文件未修改",
      };
    }
    if (context.signal.aborted) throw context.signal.reason;

    const latest = decodeUtf8(await readFile(target.absolutePath));
    if (latest !== original) {
      throw new Error("文件在确认期间发生变化，拒绝覆盖");
    }

    await writeTextAtomically(target.absolutePath, updated, info.mode);
    try {
      context.changes.record(context.workspace, {
        path: target.relativePath,
        before: original,
        after: updated,
        mode: info.mode,
      });
    } catch (error) {
      await writeTextAtomically(target.absolutePath, original, info.mode);
      throw error;
    }

    return {
      path: target.relativePath,
      applied: true,
      diff,
      message: "补丁已安全写入",
    };
  }

  summarize(output: ApplyPatchOutput): string {
    return output.applied
      ? `已修改 ${output.path}`
      : `未修改 ${output.path}（用户拒绝）`;
  }
}

function decodeUtf8(buffer: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("文件不是有效的 UTF-8 文本");
  }
}

function normalizeNewlines(value: string, eol: string): string {
  return value.replace(/\r\n|\r|\n/g, eol);
}

function countOccurrences(content: string, value: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= content.length - value.length) {
    const index = content.indexOf(value, offset);
    if (index === -1) break;
    count += 1;
    offset = index + 1;
  }
  return count;
}
