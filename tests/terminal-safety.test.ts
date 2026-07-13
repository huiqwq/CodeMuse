import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeTerminalText } from "../src/ui/terminal.ts";

test("终端输出转义控制字符并保留正常换行", () => {
  assert.equal(
    sanitizeTerminalText("\u001b[31m危险\u0007\n正常"),
    "<0x1b>[31m危险<0x07>\n正常",
  );
  assert.equal(sanitizeTerminalText("中文\ttext"), "中文\ttext");
});
