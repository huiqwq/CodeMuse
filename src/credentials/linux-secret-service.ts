import { randomUUID } from "node:crypto";
import type { CredentialProtector } from "./types.ts";
import { runSecureCommand } from "./secure-command.ts";

export class LinuxSecretServiceProtector implements CredentialProtector {
  readonly name = "linux-secret-service";
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    if (process.platform !== "linux") {
      throw new Error("Secret Service 后端只能在 Linux 上使用");
    }
    this.env = env;
  }

  async protect(secret: string): Promise<string> {
    const reference = randomUUID();
    await runSecureCommand(
      "secret-tool",
      [
        "store",
        "--label=CodeMuse API credential",
        "application", "codemuse",
        "reference", reference,
      ],
      secret,
      this.env,
    );
    return Buffer.from(reference, "utf8").toString("base64");
  }

  async unprotect(payload: string): Promise<string> {
    const reference = decodeReference(payload);
    return runSecureCommand(
      "secret-tool",
      [
        "lookup",
        "application", "codemuse",
        "reference", reference,
      ],
      "",
      this.env,
    );
  }

  async delete(payload: string): Promise<void> {
    const reference = decodeReference(payload);
    await runSecureCommand(
      "secret-tool",
      [
        "clear",
        "application", "codemuse",
        "reference", reference,
      ],
      "",
      this.env,
    );
  }
}

function decodeReference(payload: string): string {
  const value = Buffer.from(payload, "base64").toString("utf8");
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error("Linux Secret Service 凭据引用无效");
  }
  return value;
}
