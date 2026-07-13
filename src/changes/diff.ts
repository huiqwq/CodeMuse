export function createUnifiedDiff(
  path: string,
  before: string,
  after: string,
  contextLines = 3,
): string {
  if (before === after) return "";

  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const hunkStart = Math.max(0, prefix - contextLines);
  const oldChangeEnd = oldLines.length - suffix;
  const newChangeEnd = newLines.length - suffix;
  const oldHunkEnd = Math.min(oldLines.length, oldChangeEnd + contextLines);
  const newHunkEnd = Math.min(newLines.length, newChangeEnd + contextLines);
  const oldCount = oldHunkEnd - hunkStart;
  const newCount = newHunkEnd - hunkStart;
  const lines = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${hunkStart + 1},${oldCount} +${hunkStart + 1},${newCount} @@`,
  ];

  for (let index = hunkStart; index < prefix; index += 1) {
    lines.push(` ${oldLines[index]}`);
  }
  for (let index = prefix; index < oldChangeEnd; index += 1) {
    lines.push(`-${oldLines[index]}`);
  }
  for (let index = prefix; index < newChangeEnd; index += 1) {
    lines.push(`+${newLines[index]}`);
  }

  const sharedContext = Math.min(oldHunkEnd - oldChangeEnd, newHunkEnd - newChangeEnd);
  for (let index = 0; index < sharedContext; index += 1) {
    lines.push(` ${oldLines[oldChangeEnd + index]}`);
  }

  return lines.join("\n");
}

function splitLines(value: string): string[] {
  const lines = value.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
