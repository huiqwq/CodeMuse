import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { CredentialProtector } from "./types.ts";
import { WindowsDpapiProtector } from "./windows-dpapi.ts";
import { MacOsKeychainProtector } from "./macos-keychain.ts";
import { LinuxSecretServiceProtector } from "./linux-secret-service.ts";

const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 128_000;
const MAX_CREDENTIALS = 32;
const MAX_SECRET_LENGTH = 16_384;
const MAX_PAYLOAD_LENGTH = 65_536;
const CREDENTIAL_ID_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

type CredentialFile = {
  schemaVersion: 1;
  protection: string;
  credentials: Record<string, string>;
};

export type CredentialStoreOptions = {
  path?: string;
  protector?: CredentialProtector;
  env?: NodeJS.ProcessEnv;
};

export class CredentialStore {
  readonly path: string;
  readonly protection: string;
  private readonly protector: CredentialProtector;

  constructor(options: CredentialStoreOptions = {}) {
    const env = options.env ?? process.env;
    this.path = resolve(
      options.path ||
        env.CODEMUSE_CREDENTIALS_PATH?.trim() ||
        resolve(homedir(), ".codemuse", "credentials.json"),
    );
    this.protector = options.protector ?? createPlatformProtector(env);
    this.protection = this.protector.name;
  }

  async load(): Promise<Map<string, string>> {
    const file = await this.readFile();
    const secrets = new Map<string, string>();
    if (!file) return secrets;
    this.assertProtection(file);

    for (const [id, payload] of Object.entries(file.credentials)) {
      const secret = await this.protector.unprotect(payload);
      validateSecret(secret);
      secrets.set(id, secret);
    }
    return secrets;
  }

  async listIds(): Promise<string[]> {
    const file = await this.readFile();
    if (!file) return [];
    this.assertProtection(file);
    return Object.keys(file.credentials).sort();
  }

  async set(id: string, secret: string): Promise<void> {
    const normalizedId = validateCredentialId(id);
    validateSecret(secret);
    const file = await this.readFile() ?? {
      schemaVersion: SCHEMA_VERSION,
      protection: this.protection,
      credentials: {},
    };
    this.assertProtection(file);

    if (
      !(normalizedId in file.credentials) &&
      Object.keys(file.credentials).length >= MAX_CREDENTIALS
    ) {
      throw new Error(`安全凭据最多保存 ${MAX_CREDENTIALS} 项`);
    }
    const previousPayload = file.credentials[normalizedId];
    const nextPayload = await this.protector.protect(secret);
    validatePayload(nextPayload);
    file.credentials[normalizedId] = nextPayload;
    try {
      await this.writeFile(file);
    } catch (error) {
      if (this.protector.delete) {
        await this.protector.delete(nextPayload).catch(() => undefined);
      }
      throw error;
    }
    if (previousPayload && this.protector.delete) {
      await this.protector.delete(previousPayload).catch(() => undefined);
    }
  }

  async delete(id: string): Promise<boolean> {
    const normalizedId = validateCredentialId(id);
    const file = await this.readFile();
    if (!file) return false;
    this.assertProtection(file);
    if (!(normalizedId in file.credentials)) return false;
    const payload = file.credentials[normalizedId];
    delete file.credentials[normalizedId];
    await this.writeFile(file);
    if (payload && this.protector.delete) {
      await this.protector.delete(payload);
    }
    return true;
  }

  private assertProtection(file: CredentialFile): void {
    if (file.protection !== this.protection) {
      throw new Error(
        `凭据文件使用 ${file.protection}，当前后端是 ${this.protection}`,
      );
    }
  }

  private async readFile(): Promise<CredentialFile | null> {
    let info;
    try {
      info = await lstat(this.path);
    } catch (error) {
      if (isMissingFileError(error)) return null;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error("凭据文件不能是符号链接");
    if (!info.isFile()) throw new Error("凭据路径不是普通文件");
    if (info.size > MAX_FILE_BYTES) {
      throw new Error(`凭据文件超过 ${MAX_FILE_BYTES} 字节限制`);
    }

    let value: unknown;
    try {
      value = JSON.parse(await readFile(this.path, "utf8"));
    } catch {
      throw new Error("凭据文件不是有效 JSON");
    }
    return validateCredentialFile(value);
  }

  private async writeFile(file: CredentialFile): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, this.path);
      await chmod(this.path, 0o600).catch(() => undefined);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

export function createCredentialStore(
  env: NodeJS.ProcessEnv = process.env,
): CredentialStore {
  return new CredentialStore({ env });
}

export function validateCredentialId(value: string): string {
  const id = value.trim().toUpperCase();
  if (!CREDENTIAL_ID_PATTERN.test(id)) {
    throw new Error("凭据标识必须是合法的大写环境变量名");
  }
  return id;
}

function validateCredentialFile(value: unknown): CredentialFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("凭据文件必须是对象");
  }
  const object = value as Record<string, unknown>;
  const extras = Object.keys(object).filter((key) =>
    !["schemaVersion", "protection", "credentials"].includes(key)
  );
  if (extras.length) throw new Error(`凭据文件包含未知字段：${extras.join("、")}`);
  if (object.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`凭据文件 schemaVersion 必须是 ${SCHEMA_VERSION}`);
  }
  if (typeof object.protection !== "string" || !object.protection) {
    throw new Error("凭据文件 protection 无效");
  }
  if (
    !object.credentials ||
    typeof object.credentials !== "object" ||
    Array.isArray(object.credentials)
  ) {
    throw new Error("凭据文件 credentials 必须是对象");
  }

  const entries = Object.entries(object.credentials as Record<string, unknown>);
  if (entries.length > MAX_CREDENTIALS) {
    throw new Error(`凭据文件最多包含 ${MAX_CREDENTIALS} 项`);
  }
  const credentials: Record<string, string> = {};
  for (const [id, payload] of entries) {
    const normalizedId = validateCredentialId(id);
    if (normalizedId !== id) throw new Error(`凭据标识未规范化：${id}`);
    if (typeof payload !== "string") throw new Error(`凭据 ${id} 的密文无效`);
    validatePayload(payload);
    credentials[id] = payload;
  }
  return {
    schemaVersion: 1,
    protection: object.protection,
    credentials,
  };
}

function validateSecret(value: string): void {
  if (
    !value ||
    value.length > MAX_SECRET_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error("API Key 必须是非空且不含控制字符的字符串");
  }
}

function validatePayload(value: string): void {
  if (
    !value ||
    value.length > MAX_PAYLOAD_LENGTH ||
    !BASE64_PATTERN.test(value)
  ) {
    throw new Error("凭据密文不是有效 Base64");
  }
}

function createPlatformProtector(
  env: NodeJS.ProcessEnv,
): CredentialProtector {
  if (process.platform === "win32") return new WindowsDpapiProtector(env);
  if (process.platform === "darwin") return new MacOsKeychainProtector(env);
  if (process.platform === "linux") return new LinuxSecretServiceProtector(env);
  return new UnsupportedProtector();
}

class UnsupportedProtector implements CredentialProtector {
  readonly name = "unsupported";

  async protect(): Promise<string> {
    throw new Error("当前平台暂不支持持久化凭据，请继续使用环境变量");
  }

  async unprotect(): Promise<string> {
    throw new Error("当前平台暂不支持读取持久化凭据，请继续使用环境变量");
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
