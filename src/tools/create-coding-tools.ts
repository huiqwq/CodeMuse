import { createReadOnlyToolRegistry } from "./create-read-only-tools.ts";
import { ApplyPatchTool } from "./patch/apply-patch.ts";
import { ListScriptsTool } from "./scripts/list-scripts.ts";
import { RunScriptTool } from "./scripts/run-script.ts";
import type { ToolRegistry } from "./registry.ts";

export function createCodingToolRegistry(): ToolRegistry {
  return createReadOnlyToolRegistry()
    .register(new ApplyPatchTool())
    .register(new ListScriptsTool())
    .register(new RunScriptTool());
}
