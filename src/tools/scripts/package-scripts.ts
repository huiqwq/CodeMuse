import { readFile, stat } from "node:fs/promises";
import {
  resolveWorkspacePath,
  type WorkspaceContext,
} from "../../context/workspace.ts";

const MAX_PACKAGE_BYTES = 256_000;
const MAX_SCRIPTS = 200;
const MAX_SCRIPT_LENGTH = 5_000;
const ALLOWED_SCRIPT_ROOTS = new Set([
  "build",
  "check",
  "lint",
  "test",
  "typecheck",
]);

export type PackageScript = {
  name: string;
  command: string;
  allowed: boolean;
};

export type PackageScriptsSnapshot = {
  packageName: string | null;
  scripts: PackageScript[];
};

export async function readPackageScripts(
  workspace: WorkspaceContext,
): Promise<PackageScriptsSnapshot> {
  let target;
  try {
    target = await resolveWorkspacePath(workspace, "package.json");
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(
        "当前工作区根目录没有 package.json，无法使用 npm 脚本功能",
      );
    }
    throw error;
  }

  const info = await stat(target.absolutePath);
  if (!info.isFile()) throw new Error("package.json 不是普通文件");
  if (info.size > MAX_PACKAGE_BYTES) {
    throw new Error(`package.json 超过 ${MAX_PACKAGE_BYTES} 字节限制`);
  }

  const buffer = await readFile(target.absolutePath);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("package.json 不是有效的 UTF-8 文本");
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error("package.json 不是有效 JSON");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("package.json 顶层必须是对象");
  }

  const record = manifest as Record<string, unknown>;
  const scriptsValue = record.scripts;
  if (
    scriptsValue !== undefined &&
    (!scriptsValue || typeof scriptsValue !== "object" || Array.isArray(scriptsValue))
  ) {
    throw new Error("package.json 的 scripts 必须是对象");
  }

  const scripts = Object.entries(
    (scriptsValue ?? {}) as Record<string, unknown>,
  )
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .slice(0, MAX_SCRIPTS)
    .map(([name, command]) => {
      if (command.length > MAX_SCRIPT_LENGTH) {
        throw new Error(`脚本 ${name} 超过 ${MAX_SCRIPT_LENGTH} 个字符限制`);
      }
      return {
        name,
        command,
        allowed: isAllowedScriptName(name),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    packageName: typeof record.name === "string" ? record.name : null,
    scripts,
  };
}

export function isAllowedScriptName(name: string): boolean {
  const normalized = name.toLowerCase();
  if (!/^[a-z0-9:_-]+$/.test(normalized)) return false;
  if (normalized === "format:check") return true;
  const root = normalized.split(":", 1)[0];
  return ALLOWED_SCRIPT_ROOTS.has(root);
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
