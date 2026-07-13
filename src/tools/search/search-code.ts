import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  containsBinaryBytes,
  isBinaryFileName,
  isIgnoredRelativePath,
} from "../../context/ignore-rules.ts";
import {
  resolveWorkspacePath,
  toPortablePath,
} from "../../context/workspace.ts";
import type { AgentTool, ToolContext } from "../types.ts";
import {
  expectObject,
  optionalBoolean,
  optionalInteger,
  optionalString,
  requiredString,
} from "../registry.ts";

export type SearchCodeInput = {
  query: string;
  path: string;
  caseSensitive: boolean;
  maxResults: number;
};

export type SearchMatch = {
  path: string;
  line: number;
  column: number;
  preview: string;
};

export type SearchCodeOutput = {
  query: string;
  path: string;
  matches: SearchMatch[];
  filesScanned: number;
  truncated: boolean;
};

const MAX_SEARCH_FILE_BYTES = 512_000;
const MAX_FILES_SCANNED = 1_500;

export class SearchCodeTool implements AgentTool<SearchCodeInput, SearchCodeOutput> {
  readonly risk = "read" as const;
  readonly definition = {
    type: "function" as const,
    function: {
      name: "search_code",
      description: "在工作区文本文件中搜索普通文本关键词，返回文件、行号和预览。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "需要搜索的文本" },
          path: { type: "string", description: "搜索起点，默认为 ." },
          caseSensitive: { type: "boolean", description: "是否区分大小写，默认 false" },
          maxResults: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "最大匹配数，默认 50",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  };

  validate(input: unknown): SearchCodeInput {
    const object = expectObject(input, "search_code");
    const query = requiredString(object, "query");
    if (query.length > 200) throw new Error("query 不能超过 200 个字符");

    return {
      query,
      path: optionalString(object, "path", "."),
      caseSensitive: optionalBoolean(object, "caseSensitive", false),
      maxResults: optionalInteger(object, "maxResults", 50, 1, 100),
    };
  }

  async execute(input: SearchCodeInput, context: ToolContext): Promise<SearchCodeOutput> {
    const start = await resolveWorkspacePath(context.workspace, input.path, {
      allowRoot: true,
    });
    const startInfo = await stat(start.absolutePath);
    const matches: SearchMatch[] = [];
    let filesScanned = 0;
    let truncated = false;

    const inspectFile = async (absolutePath: string): Promise<void> => {
      if (context.signal.aborted) throw context.signal.reason;
      if (filesScanned >= MAX_FILES_SCANNED || matches.length >= input.maxResults) {
        truncated = true;
        return;
      }

      const relativePath = toPortablePath(relative(context.workspace.root, absolutePath));
      if (isIgnoredRelativePath(relativePath) || isBinaryFileName(relativePath)) return;

      const info = await stat(absolutePath);
      if (!info.isFile() || info.size > MAX_SEARCH_FILE_BYTES) return;

      const buffer = await readFile(absolutePath);
      if (containsBinaryBytes(buffer)) return;

      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      } catch {
        return;
      }

      filesScanned += 1;
      const needle = input.caseSensitive ? input.query : input.query.toLowerCase();
      const lines = text.split(/\r?\n/);

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        const haystack = input.caseSensitive ? line : line.toLowerCase();
        const column = haystack.indexOf(needle);
        if (column === -1) continue;

        matches.push({
          path: relativePath,
          line: lineIndex + 1,
          column: column + 1,
          preview: line.trim().slice(0, 240),
        });

        if (matches.length >= input.maxResults) {
          truncated = true;
          return;
        }
      }
    };

    const visit = async (directory: string): Promise<void> => {
      if (context.signal.aborted) throw context.signal.reason;
      if (truncated) return;
      const children = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      for (const child of children) {
        if (context.signal.aborted) throw context.signal.reason;
      if (truncated) return;
        const absolutePath = join(directory, child.name);
        const relativePath = toPortablePath(relative(context.workspace.root, absolutePath));
        if (isIgnoredRelativePath(relativePath) || child.isSymbolicLink()) continue;

        if (child.isDirectory()) await visit(absolutePath);
        else if (child.isFile()) await inspectFile(absolutePath);
      }
    };

    if (startInfo.isFile()) await inspectFile(start.absolutePath);
    else if (startInfo.isDirectory()) await visit(start.absolutePath);
    else throw new Error("搜索目标不是普通文件或目录");

    return {
      query: input.query,
      path: start.relativePath,
      matches,
      filesScanned,
      truncated,
    };
  }

  summarize(output: SearchCodeOutput): string {
    return `搜索 ${output.filesScanned} 个文件，找到 ${output.matches.length} 处${output.truncated ? "（已截断）" : ""}`;
  }
}
