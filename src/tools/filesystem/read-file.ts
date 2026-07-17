import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  containsBinaryBytes,
  isBinaryFileName,
} from "../../context/ignore-rules.ts";
import { resolveWorkspacePath } from "../../context/workspace.ts";
import type { AgentTool, ToolContext } from "../types.ts";
import { expectObject, optionalInteger, requiredString } from "../registry.ts";

export type ReadFileInput = {
  path: string;
  startLine: number;
  endLine: number;
};

export type ReadFileOutput = {
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
  fingerprint: string;
};

const MAX_FILE_BYTES = 1_000_000;
const MAX_LINES = 200;

export class ReadFileTool implements AgentTool<ReadFileInput, ReadFileOutput> {
  readonly risk = "read" as const;
  readonly definition = {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "按行读取工作区内的 UTF-8 文本文件，最多返回 200 行。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "工作区内的相对文件路径" },
          startLine: { type: "integer", minimum: 1, description: "起始行，默认为 1" },
          endLine: { type: "integer", minimum: 1, description: "结束行，最多返回 200 行" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  };

  validate(input: unknown): ReadFileInput {
    const object = expectObject(input, "read_file");
    const startLine = optionalInteger(object, "startLine", 1, 1, 10_000_000);
    const endLine = optionalInteger(
      object,
      "endLine",
      startLine + MAX_LINES - 1,
      startLine,
      startLine + MAX_LINES - 1,
    );
    return { path: requiredString(object, "path"), startLine, endLine };
  }

  async execute(input: ReadFileInput, context: ToolContext): Promise<ReadFileOutput> {
    const target = await resolveWorkspacePath(context.workspace, input.path);
    if (isBinaryFileName(target.relativePath)) throw new Error("拒绝读取二进制文件");

    const info = await stat(target.absolutePath);
    if (!info.isFile()) throw new Error("read_file 只能读取普通文件");
    if (info.size > MAX_FILE_BYTES) {
      throw new Error(`文件超过 ${MAX_FILE_BYTES} 字节限制`);
    }

    const buffer = await readFile(target.absolutePath);
    if (containsBinaryBytes(buffer)) throw new Error("文件包含二进制内容");

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw new Error("文件不是有效的 UTF-8 文本");
    }

    const lines = text.split(/\r?\n/);
    const actualStart = input.startLine;
    const actualEnd = Math.min(input.endLine, lines.length);
    const selected = actualEnd >= actualStart
      ? lines.slice(actualStart - 1, actualEnd)
      : [];

    return {
      path: target.relativePath,
      startLine: actualStart,
      endLine: actualEnd,
      totalLines: lines.length,
      fingerprint: createHash("sha256").update(buffer).digest("hex"),
      content: selected
        .map((line, index) => `${actualStart + index}: ${line}`)
        .join("\n"),
    };
  }

  summarize(output: ReadFileOutput): string {
    return `读取 ${output.path}:${output.startLine}-${output.endLine}`;
  }
}
