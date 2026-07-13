import { readPackageScripts } from "./package-scripts.ts";
import { expectObject } from "../registry.ts";
import type { AgentTool, ToolContext } from "../types.ts";

export type ListScriptsOutput = Awaited<ReturnType<typeof readPackageScripts>>;

export class ListScriptsTool implements AgentTool<Record<string, never>, ListScriptsOutput> {
  readonly risk = "read" as const;
  readonly definition = {
    type: "function" as const,
    function: {
      name: "list_scripts",
      description:
        "读取工作区根目录 package.json 的 scripts，标记哪些验证脚本允许由 CodeMuse 执行。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  };

  validate(input: unknown): Record<string, never> {
    const object = expectObject(input, "list_scripts");
    if (Object.keys(object).length > 0) {
      throw new Error("list_scripts 不接受参数");
    }
    return {};
  }

  execute(
    _input: Record<string, never>,
    context: ToolContext,
  ): Promise<ListScriptsOutput> {
    return readPackageScripts(context.workspace);
  }

  summarize(output: ListScriptsOutput): string {
    const allowed = output.scripts.filter((script) => script.allowed).length;
    return `发现 ${output.scripts.length} 个 npm scripts，其中 ${allowed} 个允许执行`;
  }
}
