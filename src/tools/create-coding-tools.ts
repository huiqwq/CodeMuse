import { createReadOnlyToolRegistry } from "./create-read-only-tools.ts";
import { ApplyPatchTool } from "./patch/apply-patch.ts";
import type { ToolRegistry } from "./registry.ts";

export function createCodingToolRegistry(): ToolRegistry {
  return createReadOnlyToolRegistry().register(new ApplyPatchTool());
}
