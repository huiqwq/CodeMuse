import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { isIgnoredRelativePath } from "./ignore-rules.ts";

export type WorkspaceContext = {
  root: string;
  realRoot: string;
};

export async function openWorkspace(rootPath: string): Promise<WorkspaceContext> {
  const root = resolve(rootPath);
  const info = await stat(root);
  if (!info.isDirectory()) {
    throw new Error(`工作区不是目录：${root}`);
  }

  return { root, realRoot: await realpath(root) };
}

export async function resolveWorkspacePath(
  workspace: WorkspaceContext,
  inputPath: string,
  options: { allowRoot?: boolean; allowIgnored?: boolean } = {},
): Promise<{ absolutePath: string; relativePath: string }> {
  const requested = inputPath.trim() || ".";
  if (isAbsolute(requested)) {
    throw new Error("只允许使用工作区内的相对路径");
  }

  const candidate = resolve(workspace.root, requested);
  assertInside(workspace.root, candidate);

  const workspaceRelative = relative(workspace.root, candidate);
  if (!options.allowRoot && !workspaceRelative) {
    throw new Error("该操作需要指定工作区内的文件或目录");
  }
  if (!options.allowIgnored && workspaceRelative && isIgnoredRelativePath(workspaceRelative)) {
    throw new Error(`路径已被安全规则忽略：${toPortablePath(workspaceRelative)}`);
  }

  const realCandidate = await realpath(candidate);
  assertInside(workspace.realRoot, realCandidate);

  return {
    absolutePath: realCandidate,
    relativePath: workspaceRelative ? toPortablePath(workspaceRelative) : ".",
  };
}

export function toPortablePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function assertInside(root: string, candidate: string): void {
  const value = relative(root, candidate);
  if (value === "") return;
  if (
    value === ".." ||
    value.startsWith(`..\\`) ||
    value.startsWith("../") ||
    isAbsolute(value)
  ) {
    throw new Error("拒绝访问工作区之外的路径");
  }
}
