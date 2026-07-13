import { basename, extname, sep } from "node:path";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".codemuse",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  "out",
]);

const BINARY_EXTENSIONS = new Set([
  ".7z", ".avi", ".bmp", ".class", ".dll", ".doc", ".docx", ".exe",
  ".gif", ".gz", ".ico", ".jar", ".jpeg", ".jpg", ".lockb", ".mov",
  ".mp3", ".mp4", ".pdf", ".png", ".pyc", ".so", ".tar", ".webp",
  ".woff", ".woff2", ".xls", ".xlsx", ".zip",
]);

const SENSITIVE_FILES = new Set([
  ".npmrc",
  ".pypirc",
  "id_rsa",
  "id_ed25519",
]);

export function isIgnoredRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("/", sep);
  const segments = normalized.split(sep).filter(Boolean);

  if (segments.some((segment) => IGNORED_DIRECTORIES.has(segment))) {
    return true;
  }

  const name = basename(normalized).toLowerCase();
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) {
    return true;
  }

  return SENSITIVE_FILES.has(name);
}

export function isBinaryFileName(fileName: string): boolean {
  return BINARY_EXTENSIONS.has(extname(fileName).toLowerCase());
}

export function containsBinaryBytes(buffer: Uint8Array): boolean {
  const length = Math.min(buffer.length, 8192);
  for (let index = 0; index < length; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}
