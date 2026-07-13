import { ListFilesTool } from "./filesystem/list-files.ts";
import { ReadFileTool } from "./filesystem/read-file.ts";
import { SearchCodeTool } from "./search/search-code.ts";
import { ToolRegistry } from "./registry.ts";

export function createReadOnlyToolRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(new ListFilesTool())
    .register(new ReadFileTool())
    .register(new SearchCodeTool());
}
