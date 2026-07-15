import { link, open, rename, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export async function writeTextAtomically(
  absolutePath: string,
  content: string,
  mode: number,
): Promise<void> {
  const temporaryPath = join(
    dirname(absolutePath),
    `.${basename(absolutePath)}.codemuse-${process.pid}-${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode,
    });
    await rename(temporaryPath, absolutePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function createTextFileExclusive(
  absolutePath: string,
  content: string,
  mode = 0o666,
): Promise<void> {
  const handle = await open(absolutePath, "wx", mode);
  try {
    await handle.writeFile(content, "utf8");
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(absolutePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function renameFileExclusively(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  await link(sourcePath, destinationPath);
  try {
    await unlink(sourcePath);
  } catch (error) {
    await unlink(destinationPath).catch(() => undefined);
    throw error;
  }
}
