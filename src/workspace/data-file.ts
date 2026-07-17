import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, join, relative } from "node:path";
import { openWorkspace } from "../context/workspace.ts";

const DEFAULT_MAX_BYTES = 512_000;

export class WorkspaceDataFile {
  readonly path: string;
  private readonly workspaceRoot: string;
  private readonly maxBytes: number;

  constructor(
    workspaceRoot: string,
    fileName: string,
    maxBytes = DEFAULT_MAX_BYTES,
  ) {
    if (!/^[a-z][a-z0-9-]*\.json$/i.test(fileName)) {
      throw new Error("工作区数据文件名无效");
    }
    this.workspaceRoot = workspaceRoot;
    this.path = join(workspaceRoot, ".codemuse", fileName);
    this.maxBytes = maxBytes;
  }

  async read(): Promise<unknown | null> {
    const workspace = await openWorkspace(this.workspaceRoot);
    const directory = join(workspace.root, ".codemuse");
    try {
      const directoryInfo = await lstat(directory);
      if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
        throw new Error(".codemuse 必须是工作区内的普通目录");
      }
      const realDirectory = await realpath(directory);
      assertInside(workspace.realRoot, realDirectory);

      const info = await lstat(this.path);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new Error("工作区数据必须是普通文件");
      }
      if (info.size > this.maxBytes) {
        throw new Error(`工作区数据超过 ${this.maxBytes} 字节限制`);
      }
      return JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if (isMissingFileError(error)) return null;
      if (error instanceof SyntaxError) {
        throw new Error(`工作区数据不是有效 JSON：${this.path}`);
      }
      throw error;
    }
  }

  async write(value: unknown): Promise<void> {
    const workspace = await openWorkspace(this.workspaceRoot);
    const directory = join(workspace.root, ".codemuse");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const directoryInfo = await lstat(directory);
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
      throw new Error(".codemuse 必须是工作区内的普通目录");
    }
    const realDirectory = await realpath(directory);
    assertInside(workspace.realRoot, realDirectory);

    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > this.maxBytes) {
      throw new Error(`工作区数据超过 ${this.maxBytes} 字节限制`);
    }
    const temporary = join(
      directory,
      `.${basename(this.path)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, serialized, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async remove(): Promise<void> {
    if (await this.read() === null) return;
    await rm(this.path, { force: true });
  }
}

function assertInside(root: string, target: string): void {
  const value = relative(root, target);
  if (value === ".." || value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("工作区数据目录越界");
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT";
}
