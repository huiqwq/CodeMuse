import { rename, rm, writeFile } from "node:fs/promises";
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
