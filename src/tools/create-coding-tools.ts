import { createReadOnlyToolRegistry } from "./create-read-only-tools.ts";
import { CreateFileTool } from "./filesystem/create-file.ts";
import { DeleteFileTool } from "./filesystem/delete-file.ts";
import { RenameFileTool } from "./filesystem/rename-file.ts";
import { GitDiffTool } from "./git/git-diff.ts";
import { GitStatusTool } from "./git/git-status.ts";
import { ApplyPatchTool } from "./patch/apply-patch.ts";
import { ListScriptsTool } from "./scripts/list-scripts.ts";
import { RunScriptTool } from "./scripts/run-script.ts";
import type { ToolRegistry } from "./registry.ts";

export function createCodingToolRegistry(): ToolRegistry {
  return createReadOnlyToolRegistry()
    .register(new ApplyPatchTool())
    .register(new CreateFileTool())
    .register(new RenameFileTool())
    .register(new DeleteFileTool())
    .register(new GitStatusTool())
    .register(new GitDiffTool())
    .register(new ListScriptsTool())
    .register(new RunScriptTool());
}
