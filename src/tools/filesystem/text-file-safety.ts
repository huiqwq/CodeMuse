import { lstat, readFile, stat } from "node:fs/promises";
import {
  containsBinaryBytes,
  isBinaryFileName,
} from "../../context/ignore-rules.ts";
import { resolve } from "node:path";
import type { WorkspaceContext } from "../../context/workspace.ts";

export const MAX_TEXT_FILE_BYTES = 1_000_000;
export const MAX_NEW_FILE_BYTES = 100_000;
const MAX_APPROVAL_DIFF = 24_000;

export type SafeTextFile = {
  content: string;
  mode: number;
};

export async function readSafeTextFile(
  absolutePath: string,
  relativePath: string,
): Promise<SafeTextFile> {
  assertTextFileName(relativePath);
  const info = await stat(absolutePath);
  if (!info.isFile()) throw new Error("只支持普通文本文件");
  if (info.size > MAX_TEXT_FILE_BYTES) {
    throw new Error(`文件超过 ${MAX_TEXT_FILE_BYTES} 字节限制`);
  }
  const buffer = await readFile(absolutePath);
  if (containsBinaryBytes(buffer)) throw new Error("文件包含二进制内容");
  return {
    content: decodeUtf8(buffer),
    mode: info.mode,
  };
}

export async function assertNotSymbolicLink(
  workspace: WorkspaceContext,
  relativePath: string,
): Promise<void> {
  const info = await lstat(resolve(workspace.root, relativePath));
  if (info.isSymbolicLink()) {
    throw new Error("拒绝删除或重命名符号链接");
  }
}
export function validateNewText(content: string): void {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_NEW_FILE_BYTES) {
    throw new Error(`新文件内容不能超过 ${MAX_NEW_FILE_BYTES} 字节`);
  }
  if (content.includes("\0")) throw new Error("新文件内容不能包含 NUL 字节");
  const encoded = new TextEncoder().encode(content);
  if (new TextDecoder("utf-8", { fatal: true }).decode(encoded) !== content) {
    throw new Error("新文件内容包含无效 Unicode 字符");
  }
}

export function assertTextFileName(relativePath: string): void {
  if (isBinaryFileName(relativePath)) {
    throw new Error("拒绝操作二进制文件");
  }
}

export function limitApprovalDiff(diff: string): string {
  return diff.length <= MAX_APPROVAL_DIFF
    ? diff
    : `${diff.slice(0, MAX_APPROVAL_DIFF)}\n...Diff 已截断，完整文件不会发送到终端`;
}

export function decodeUtf8(buffer: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("文件不是有效的 UTF-8 文本");
  }
}
