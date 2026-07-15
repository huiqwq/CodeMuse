import {
  lstat,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { ModelConfig } from "../types.ts";
import {
  MODEL_PRESETS,
  loadModelConfig,
  normalizeBaseUrl,
  normalizeProvider,
  validateModelName,
} from "./config.ts";

const CONFIG_SCHEMA_VERSION = 1;
const MAX_CONFIG_BYTES = 128_000;
const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,49}$/;
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export type ModelProfileDefinition = {
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export type ResolvedModelProfile = ModelProfileDefinition & {
  configured: boolean;
  credentialSource: "environment" | "stored" | null;
  source: "builtin" | "file" | "environment";
  config: ModelConfig | null;
};

export type ModelCatalog = {
  configPath: string;
  activeProfile: string;
  profiles: ResolvedModelProfile[];
  configExists: boolean;
};

type ProfileFile = {
  schemaVersion: 1;
  activeProfile?: string;
  profiles: ModelProfileDefinition[];
};

const BUILTIN_PROFILES: ModelProfileDefinition[] = [
  {
    name: "deepseek",
    provider: "deepseek",
    baseUrl: MODEL_PRESETS.deepseek.baseUrl,
    model: MODEL_PRESETS.deepseek.model,
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  {
    name: "glm",
    provider: "glm",
    baseUrl: MODEL_PRESETS.glm.baseUrl,
    model: MODEL_PRESETS.glm.model,
    apiKeyEnv: "ZHIPUAI_API_KEY",
  },
  {
    name: "glm-flash",
    provider: "glm",
    baseUrl: MODEL_PRESETS.glm.baseUrl,
    model: "glm-4.7-flash",
    apiKeyEnv: "ZHIPUAI_API_KEY",
  },
  {
    name: "openai",
    provider: "openai",
    baseUrl: MODEL_PRESETS.openai.baseUrl,
    model: MODEL_PRESETS.openai.model,
    apiKeyEnv: "OPENAI_API_KEY",
  },
];

export function resolveProfileConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(
    env.CODEMUSE_CONFIG_PATH?.trim() ||
      resolve(homedir(), ".codemuse", "config.json"),
  );
}

export async function loadModelCatalog(
  env: NodeJS.ProcessEnv = process.env,
  storedCredentials: ReadonlyMap<string, string> = new Map(),
): Promise<ModelCatalog> {
  const configPath = resolveProfileConfigPath(env);
  const profileFile = await readProfileFile(configPath);
  const definitions = new Map<string, {
    definition: ModelProfileDefinition;
    source: ResolvedModelProfile["source"];
  }>();

  for (const definition of BUILTIN_PROFILES) {
    definitions.set(definition.name, {
      definition: structuredClone(definition),
      source: "builtin",
    });
  }
  for (const definition of profileFile?.profiles ?? []) {
    definitions.set(definition.name, {
      definition,
      source: "file",
    });
  }

  const legacy = loadModelConfig(env);
  if (legacy) {
    const name = "environment";
    definitions.set(name, {
      definition: {
        name,
        provider: legacy.provider,
        baseUrl: legacy.baseUrl,
        model: legacy.model,
        apiKeyEnv: "CODEMUSE_API_KEY",
        ...(legacy.timeoutMs !== undefined ? { timeoutMs: legacy.timeoutMs } : {}),
        ...(legacy.maxRetries !== undefined ? { maxRetries: legacy.maxRetries } : {}),
      },
      source: "environment",
    });
  }

  const profiles = [...definitions.values()].map(({ definition, source }) =>
    resolveProfile(definition, source, env, storedCredentials)
  );
  const requested = env.CODEMUSE_PROFILE?.trim() ||
    (legacy ? "environment" : "") ||
    profileFile?.activeProfile ||
    profiles.find((profile) => profile.configured)?.name ||
    "deepseek";
  const activeProfile = validateProfileName(requested);
  if (!profiles.some((profile) => profile.name === activeProfile)) {
    throw new Error(`模型配置中不存在 Profile：${activeProfile}`);
  }

  return {
    configPath,
    activeProfile,
    profiles,
    configExists: profileFile !== null,
  };
}

export async function initializeProfileConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ path: string; created: boolean }> {
  const path = resolveProfileConfigPath(env);
  try {
    await lstat(path);
    return { path, created: false };
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const file: ProfileFile = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    activeProfile: "deepseek",
    profiles: BUILTIN_PROFILES.map((profile) => structuredClone(profile)),
  };
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return { path, created: true };
}

function resolveProfile(
  definition: ModelProfileDefinition,
  source: ResolvedModelProfile["source"],
  env: NodeJS.ProcessEnv,
  storedCredentials: ReadonlyMap<string, string>,
): ResolvedModelProfile {
  const environmentKey = env[definition.apiKeyEnv]?.trim();
  const storedKey = storedCredentials.get(definition.apiKeyEnv)?.trim();
  const apiKey = environmentKey || storedKey;
  return {
    ...definition,
    configured: Boolean(apiKey),
    credentialSource: environmentKey ? "environment" : storedKey ? "stored" : null,
    source,
    config: apiKey
      ? {
          provider: definition.provider,
          apiKey,
          baseUrl: definition.baseUrl,
          model: definition.model,
          ...(definition.timeoutMs !== undefined
            ? { timeoutMs: definition.timeoutMs }
            : {}),
          ...(definition.maxRetries !== undefined
            ? { maxRetries: definition.maxRetries }
            : {}),
        }
      : null,
  };
}

async function readProfileFile(path: string): Promise<ProfileFile | null> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
  if (info.isSymbolicLink()) throw new Error("模型配置文件不能是符号链接");
  if (!info.isFile()) throw new Error("模型配置路径不是普通文件");
  if (info.size > MAX_CONFIG_BYTES) {
    throw new Error(`模型配置文件超过 ${MAX_CONFIG_BYTES} 字节限制`);
  }

  const text = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("模型配置文件不是有效 JSON");
  }
  return validateProfileFile(value);
}

function validateProfileFile(value: unknown): ProfileFile {
  const object = expectRecord(value, "模型配置");
  rejectUnknownKeys(object, ["schemaVersion", "activeProfile", "profiles"], "模型配置");
  if (object.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(`模型配置 schemaVersion 必须是 ${CONFIG_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(object.profiles) || object.profiles.length > 20) {
    throw new Error("模型配置 profiles 必须是最多 20 项的数组");
  }
  const profiles = object.profiles.map((item, index) =>
    validateProfile(item, index)
  );
  if (new Set(profiles.map((profile) => profile.name)).size !== profiles.length) {
    throw new Error("模型配置 Profile 名称不能重复");
  }

  let activeProfile: string | undefined;
  if (object.activeProfile !== undefined) {
    if (typeof object.activeProfile !== "string") {
      throw new Error("activeProfile 必须是字符串");
    }
    activeProfile = validateProfileName(object.activeProfile);
    if (!profiles.some((profile) => profile.name === activeProfile) &&
        !BUILTIN_PROFILES.some((profile) => profile.name === activeProfile)) {
      throw new Error(`activeProfile 不存在：${activeProfile}`);
    }
  }

  return {
    schemaVersion: 1,
    ...(activeProfile ? { activeProfile } : {}),
    profiles,
  };
}

function validateProfile(value: unknown, index: number): ModelProfileDefinition {
  const object = expectRecord(value, `profiles[${index}]`);
  rejectUnknownKeys(
    object,
    [
      "name",
      "provider",
      "baseUrl",
      "model",
      "apiKeyEnv",
      "timeoutMs",
      "maxRetries",
    ],
    `profiles[${index}]`,
  );
  if (typeof object.name !== "string") throw new Error("Profile name 必须是字符串");
  if (typeof object.provider !== "string") throw new Error("Profile provider 必须是字符串");
  if (typeof object.baseUrl !== "string") throw new Error("Profile baseUrl 必须是字符串");
  if (typeof object.model !== "string") throw new Error("Profile model 必须是字符串");
  if (typeof object.apiKeyEnv !== "string" ||
      !ENV_NAME_PATTERN.test(object.apiKeyEnv)) {
    throw new Error("Profile apiKeyEnv 必须是合法的大写环境变量名");
  }

  return {
    name: validateProfileName(object.name),
    provider: normalizeProvider(object.provider),
    baseUrl: normalizeBaseUrl(object.baseUrl),
    model: validateModelName(object.model),
    apiKeyEnv: object.apiKeyEnv,
    ...(object.timeoutMs !== undefined
      ? { timeoutMs: validateInteger(object.timeoutMs, "timeoutMs", 5_000, 120_000) }
      : {}),
    ...(object.maxRetries !== undefined
      ? { maxRetries: validateInteger(object.maxRetries, "maxRetries", 0, 5) }
      : {}),
  };
}

function validateProfileName(value: string): string {
  const name = value.trim().toLowerCase();
  if (!PROFILE_NAME_PATTERN.test(name)) {
    throw new Error("Profile 名称格式无效");
  }
  return name;
}

function validateInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) ||
      (value as number) < minimum ||
      (value as number) > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return value as number;
}

function expectRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  object: Record<string, unknown>,
  allowed: string[],
  name: string,
): void {
  const extras = Object.keys(object).filter((key) => !allowed.includes(key));
  if (extras.length) {
    throw new Error(
      `${name} 包含未知字段：${extras.join("、")}。API Key 只能通过环境变量提供`,
    );
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
