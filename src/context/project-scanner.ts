import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { isIgnoredRelativePath } from "./ignore-rules.ts";
import {
  resolveWorkspacePath,
  toPortablePath,
  type WorkspaceContext,
} from "./workspace.ts";
import type { ProjectScan } from "../types.ts";

const MAX_FILES = 2_500;
const MAX_DEPTH = 12;

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".c": "C",
  ".cpp": "C++",
  ".cs": "C#",
  ".css": "CSS",
  ".go": "Go",
  ".html": "HTML",
  ".java": "Java",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".kt": "Kotlin",
  ".php": "PHP",
  ".py": "Python",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".scss": "SCSS",
  ".swift": "Swift",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".vue": "Vue",
};

const FRAMEWORK_PACKAGES: Record<string, string> = {
  "@angular/core": "Angular",
  "@nestjs/core": "NestJS",
  express: "Express",
  fastify: "Fastify",
  next: "Next.js",
  react: "React",
  svelte: "Svelte",
  vite: "Vite",
  vue: "Vue",
};

const KEY_FILE_NAMES = new Set([
  "cargo.toml",
  "composer.json",
  "go.mod",
  "package.json",
  "pyproject.toml",
  "readme.md",
  "requirements.txt",
  "tsconfig.json",
]);

type PackageManifest = {
  name?: unknown;
  main?: unknown;
  bin?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
};

export async function scanProject(
  workspace: WorkspaceContext,
  signal: AbortSignal,
): Promise<ProjectScan> {
  const files: string[] = [];
  let truncated = false;

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (signal.aborted) throw signal.reason;
    if (depth > MAX_DEPTH || truncated) return;

    const children = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    for (const child of children) {
      if (signal.aborted) throw signal.reason;
      const absolutePath = join(directory, child.name);
      const relativePath = toPortablePath(relative(workspace.root, absolutePath));
      if (isIgnoredRelativePath(relativePath) || child.isSymbolicLink()) continue;

      if (child.isDirectory()) {
        await visit(absolutePath, depth + 1);
      } else if (child.isFile()) {
        if (files.length >= MAX_FILES) {
          truncated = true;
          return;
        }
        files.push(relativePath);
      }
    }
  };

  await visit(workspace.root, 1);

  const packageManifest = files.includes("package.json")
    ? await readPackageManifest(workspace)
    : null;
  const languages = detectLanguages(files);
  const frameworks = detectFrameworks(packageManifest);

  return {
    projectName: typeof packageManifest?.name === "string" && packageManifest.name.trim()
      ? packageManifest.name.trim()
      : basename(workspace.root),
    projectTypes: detectProjectTypes(files, languages),
    languages,
    frameworks,
    packageManager: detectPackageManager(files),
    fileCount: files.length,
    files,
    keyFiles: detectKeyFiles(files, packageManifest),
    truncated,
  };
}

async function readPackageManifest(
  workspace: WorkspaceContext,
): Promise<PackageManifest | null> {
  try {
    const target = await resolveWorkspacePath(workspace, "package.json");
    const text = await readFile(target.absolutePath, "utf8");
    if (text.length > 256_000) return null;
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as PackageManifest
      : null;
  } catch {
    return null;
  }
}

function detectLanguages(files: string[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const language = LANGUAGE_BY_EXTENSION[extname(file).toLowerCase()];
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([language]) => language);
}

function detectFrameworks(manifest: PackageManifest | null): string[] {
  if (!manifest) return [];
  const dependencies = {
    ...asStringRecord(manifest.dependencies),
    ...asStringRecord(manifest.devDependencies),
  };
  return Object.entries(FRAMEWORK_PACKAGES)
    .filter(([name]) => name in dependencies)
    .map(([, framework]) => framework);
}

function detectProjectTypes(files: string[], languages: string[]): string[] {
  const types: string[] = [];
  if (files.includes("package.json")) types.push("Node.js");
  if (files.includes("tsconfig.json") || languages.includes("TypeScript")) {
    types.push("TypeScript");
  } else if (languages.includes("JavaScript")) {
    types.push("JavaScript");
  }
  if (files.includes("pyproject.toml") || files.includes("requirements.txt")) types.push("Python");
  if (files.includes("go.mod")) types.push("Go");
  if (files.includes("Cargo.toml")) types.push("Rust");
  return types.length ? [...new Set(types)] : ["通用项目"];
}

function detectPackageManager(files: string[]): string | null {
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "Yarn";
  if (files.includes("package-lock.json")) return "npm";
  if (files.includes("bun.lock") || files.includes("bun.lockb")) return "Bun";
  return files.includes("package.json") ? "npm（未检测到锁文件）" : null;
}

function detectKeyFiles(
  files: string[],
  manifest: PackageManifest | null,
): string[] {
  const keyFiles = new Set(files.filter((file) => KEY_FILE_NAMES.has(file.toLowerCase())));
  if (manifest) {
    if (typeof manifest.main === "string") keyFiles.add(normalizeManifestPath(manifest.main));
    if (typeof manifest.bin === "string") keyFiles.add(normalizeManifestPath(manifest.bin));
    else if (manifest.bin && typeof manifest.bin === "object" && !Array.isArray(manifest.bin)) {
      for (const value of Object.values(manifest.bin)) {
        if (typeof value === "string") keyFiles.add(normalizeManifestPath(value));
      }
    }
  }
  return [...keyFiles].filter((file) => files.includes(file)).sort();
}

function normalizeManifestPath(value: string): string {
  return value.replace(/^\.\//, "").replaceAll("\\", "/");
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string",
    ),
  );
}
