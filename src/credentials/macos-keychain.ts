import { randomUUID } from "node:crypto";
import type { CredentialProtector } from "./types.ts";
import { runSecureCommand } from "./secure-command.ts";

const ACCOUNT = "codemuse";
const SERVICE_PREFIX = "com.codemuse.credentials.";

export class MacOsKeychainProtector implements CredentialProtector {
  readonly name = "macos-keychain";
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    if (process.platform !== "darwin") {
      throw new Error("macOS Keychain 后端只能在 macOS 上使用");
    }
    this.env = env;
  }

  async protect(secret: string): Promise<string> {
    const reference = randomUUID();
    const service = `${SERVICE_PREFIX}${reference}`;
    await runSecureCommand(
      "/usr/bin/security",
      [
        "add-generic-password",
        "-a", ACCOUNT,
        "-s", service,
        "-U",
        "-w",
      ],
      `${secret}\n`,
      this.env,
    );
    return Buffer.from(reference, "utf8").toString("base64");
  }

  async unprotect(payload: string): Promise<string> {
    const reference = decodeReference(payload);
    return runSecureCommand(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-a", ACCOUNT,
        "-s", `${SERVICE_PREFIX}${reference}`,
        "-w",
      ],
      "",
      this.env,
    );
  }

  async delete(payload: string): Promise<void> {
    const reference = decodeReference(payload);
    await runSecureCommand(
      "/usr/bin/security",
      [
        "delete-generic-password",
        "-a", ACCOUNT,
        "-s", `${SERVICE_PREFIX}${reference}`,
      ],
      "",
      this.env,
    );
  }
}

function decodeReference(payload: string): string {
  const value = Buffer.from(payload, "base64").toString("utf8");
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error("macOS Keychain 凭据引用无效");
  }
  return value;
}
