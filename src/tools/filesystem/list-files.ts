import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { isIgnoredRelativePath } from "../../context/ignore-rules.ts";
import {
  resolveWorkspacePath,
  toPortablePath,
} from "../../context/workspace.ts";
import type { AgentTool, ToolContext } from "../types.ts";
import {
  expectObject,
  optionalInteger,
  optionalString,
} from "../registry.ts";

export type ListFilesInput = {
  path: string;
  maxDepth: number;
};

export type ListFilesOutput = {
  path: string;
  entries: Array<{ path: string; type: "file" | "directory" }>;
  truncated: boolean;
};

const MAX_ENTRIES = 500;

export class ListFilesTool implements AgentTool<ListFilesInput, ListFilesOutput> {
  readonly risk = "read" as const;
  readonly definition = {
    type: "function" as const,
    function: {
      name: "list_files",
      description: "列出工作区内的文件和目录。用于了解项目结构，不读取文件内容。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "工作区相对路径，默认为 ." },
          maxDepth: {
            type: "integer",
            minimum: 1,
            maximum: 8,
            description: "递归深度，默认为 3",
          },
        },
        additionalProperties: false,
      },
    },
  };

  validate(input: unknown): ListFilesInput {
    const object = expectObject(input, "list_files");
    return {
      path: optionalString(object, "path", "."),
      maxDepth: optionalInteger(object, "maxDepth", 3, 1, 8),
    };
  }

  async execute(input: ListFilesInput, context: ToolContext): Promise<ListFilesOutput> {
    const start = await resolveWorkspacePath(context.workspace, input.path, {
      allowRoot: true,
    });
    const startInfo = await stat(start.absolutePath);
    const entries: ListFilesOutput["entries"] = [];
    let truncated = false;

    if (startInfo.isFile()) {
      return {
        path: start.relativePath,
        entries: [{ path: start.relativePath, type: "file" }],
        truncated: false,
      };
    }
    if (!startInfo.isDirectory()) throw new Error("目标不是普通文件或目录");

    const visit = async (directory: string, depth: number): Promise<void> => {
      if (context.signal.aborted) throw context.signal.reason;
      if (depth > input.maxDepth || truncated) return;

      const children = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      for (const child of children) {
        if (context.signal.aborted) throw context.signal.reason;
        const absolutePath = join(directory, child.name);
        const relativePath = toPortablePath(relative(context.workspace.root, absolutePath));
        if (isIgnoredRelativePath(relativePath) || child.isSymbolicLink()) continue;

        if (entries.length >= MAX_ENTRIES) {
          truncated = true;
          return;
        }

        if (child.isDirectory()) {
          entries.push({ path: `${relativePath}/`, type: "directory" });
          await visit(absolutePath, depth + 1);
        } else if (child.isFile()) {
          entries.push({ path: relativePath, type: "file" });
        }
      }
    };

    await visit(start.absolutePath, 1);
    return { path: start.relativePath, entries, truncated };
  }

  summarize(output: ListFilesOutput): string {
    return `列出 ${output.entries.length} 项${output.truncated ? "（已截断）" : ""}`;
  }
}
