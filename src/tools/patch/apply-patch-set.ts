import { createHash, randomUUID } from "node:crypto";
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

const MAX_PATCHES = 10;
const MAX_FILE_BYTES = 1_000_000;
const MAX_PATCH_TEXT = 50_000;

type PatchItem = {
  path: string;
  oldText: string;
  newText: string;
};

type PreparedPatch = PatchItem & {
  absolutePath: string;
  relativePath: string;
  original: string;
  updated: string;
  mode: number;
  diff: string;
};

export type ApplyPatchSetInput = { patches: PatchItem[] };
export type ApplyPatchSetOutput = {
  paths: string[];
  applied: boolean;
  diff: string;
  message: string;
};

export class ApplyPatchSetTool
  implements AgentTool<ApplyPatchSetInput, ApplyPatchSetOutput> {
  readonly risk = "write" as const;
  readonly definition = {
    type: "function" as const,
    function: {
      name: "apply_patch_set",
      description:
        "一次预览并原子应用 2—10 个已读取文本文件的精确局部补丁；任一文件变化或写入失败会拒绝或回滚整个变更集。",
      parameters: {
        type: "object",
        properties: {
          patches: {
            type: "array",
            minItems: 2,
            maxItems: MAX_PATCHES,
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                oldText: { type: "string" },
                newText: { type: "string" },
              },
              required: ["path", "oldText", "newText"],
              additionalProperties: false,
            },
          },
        },
        required: ["patches"],
        additionalProperties: false,
      },
    },
  };

  validate(input: unknown): ApplyPatchSetInput {
    const object = expectObject(input, "apply_patch_set");
    if (
      !Array.isArray(object.patches) ||
      object.patches.length < 2 ||
      object.patches.length > MAX_PATCHES
    ) {
      throw new Error(`patches 必须包含 2—${MAX_PATCHES} 个补丁`);
    }
    const patches = object.patches.map((value) => {
      const patch = expectObject(value, "apply_patch_set.patches");
      const oldText = requiredString(patch, "oldText");
      const newText = requiredStringValue(patch, "newText");
      if (oldText.length > MAX_PATCH_TEXT || newText.length > MAX_PATCH_TEXT) {
        throw new Error(`补丁片段不能超过 ${MAX_PATCH_TEXT} 个字符`);
      }
      return {
        path: requiredString(patch, "path"),
        oldText,
        newText,
      };
    });
    if (new Set(patches.map((patch) => patch.path)).size !== patches.length) {
      throw new Error("同一文件在一个变更集中只能出现一次");
    }
    return { patches };
  }

  async execute(
    input: ApplyPatchSetInput,
    context: ToolContext,
  ): Promise<ApplyPatchSetOutput> {
    const prepared: PreparedPatch[] = [];
    for (const patch of input.patches) {
      const target = await resolveWorkspacePath(context.workspace, patch.path);
      if (isBinaryFileName(target.relativePath)) throw new Error("拒绝修改二进制文件");
      if (!context.hasObservedFile(target.relativePath)) {
        throw new Error(`修改前必须 read_file：${target.relativePath}`);
      }
      const info = await stat(target.absolutePath);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) {
        throw new Error(`文件无效或超过大小限制：${target.relativePath}`);
      }
      const buffer = await readFile(target.absolutePath);
      if (containsBinaryBytes(buffer)) throw new Error("文件包含二进制内容");
      const fingerprint = createHash("sha256").update(buffer).digest("hex");
      if (context.getObservedFileFingerprint(target.relativePath) !== fingerprint) {
        throw new Error(`文件在读取后发生变化：${target.relativePath}`);
      }
      const original = decodeUtf8(buffer);
      const eol = original.includes("\r\n") ? "\r\n" : "\n";
      const oldText = normalizeNewlines(patch.oldText, eol);
      const newText = normalizeNewlines(patch.newText, eol);
      if (countOccurrences(original, oldText) !== 1) {
        throw new Error(`旧片段必须唯一出现：${target.relativePath}`);
      }
      if (oldText === newText) throw new Error(`补丁没有变化：${target.relativePath}`);
      const updated = original.replace(oldText, newText);
      if (Buffer.byteLength(updated, "utf8") > MAX_FILE_BYTES) {
        throw new Error(`修改后文件超过大小限制：${target.relativePath}`);
      }
      prepared.push({
        ...patch,
        oldText,
        newText,
        absolutePath: target.absolutePath,
        relativePath: target.relativePath,
        original,
        updated,
        mode: info.mode,
        diff: createUnifiedDiff(target.relativePath, original, updated),
      });
    }
    context.changes.assertCanRecordOperations(
      context.workspace,
      prepared.length,
      ...prepared.map((patch) => patch.relativePath),
    );
    const diff = prepared.map((patch) => patch.diff).join("\n\n");
    const decision = await context.requestApproval({
      id: randomUUID(),
      kind: "write",
      title: `确认应用 ${prepared.length} 个文件的变更集`,
      summary: "全部补丁一次确认；冲突或失败时不保留部分写入",
      paths: prepared.map((patch) => patch.relativePath),
      diff,
    }, context.signal);
    if (decision !== "approved") {
      return {
        paths: prepared.map((patch) => patch.relativePath),
        applied: false,
        diff,
        message: "用户拒绝变更集",
      };
    }

    for (const patch of prepared) {
      if (decodeUtf8(await readFile(patch.absolutePath)) !== patch.original) {
        throw new Error(`文件在确认期间发生变化：${patch.relativePath}`);
      }
    }
    const written: PreparedPatch[] = [];
    try {
      for (const patch of prepared) {
        await writeTextAtomically(patch.absolutePath, patch.updated, patch.mode);
        written.push(patch);
      }
    } catch (error) {
      for (const patch of written.reverse()) {
        await writeTextAtomically(
          patch.absolutePath,
          patch.original,
          patch.mode,
        ).catch(() => undefined);
      }
      throw error;
    }
    for (const patch of prepared) {
      context.changes.record(context.workspace, {
        kind: "modify",
        path: patch.relativePath,
        before: patch.original,
        after: patch.updated,
        mode: patch.mode,
      });
    }
    return {
      paths: prepared.map((patch) => patch.relativePath),
      applied: true,
      diff,
      message: "多文件变更集已安全写入",
    };
  }

  summarize(output: ApplyPatchSetOutput): string {
    return output.applied
      ? `已修改 ${output.paths.length} 个文件：${output.paths.join("、")}`
      : "未应用多文件变更集（用户拒绝）";
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
