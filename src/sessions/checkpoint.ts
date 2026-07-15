import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { scanProject } from "../context/project-scanner.ts";
import { openWorkspace } from "../context/workspace.ts";
import type { WorkspaceCheckpoint } from "./types.ts";

const STAT_BATCH_SIZE = 64;

export async function createWorkspaceCheckpoint(
  workspaceRoot: string,
  signal: AbortSignal,
): Promise<WorkspaceCheckpoint> {
  const workspace = await openWorkspace(workspaceRoot);
  const project = await scanProject(workspace, signal);
  const hash = createHash("sha256");
  hash.update(project.truncated ? "truncated\n" : "complete\n");

  for (let offset = 0; offset < project.files.length; offset += STAT_BATCH_SIZE) {
    if (signal.aborted) throw signal.reason;
    const batch = project.files.slice(offset, offset + STAT_BATCH_SIZE);
    const entries = await Promise.all(batch.map(async (path) => {
      const absolutePath = join(workspace.root, ...path.split("/"));
      try {
        const info = await stat(absolutePath);
        return `${path}\0${info.size}\0${Math.trunc(info.mtimeMs)}\n`;
      } catch {
        return `${path}\0missing\n`;
      }
    }));
    for (const entry of entries) hash.update(entry);
  }

  return {
    fingerprint: hash.digest("hex"),
    fileCount: project.fileCount,
    truncated: project.truncated,
  };
}
