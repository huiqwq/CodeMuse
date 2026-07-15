import type { ModelConfig } from "../types.ts";

export const MODEL_PRESETS: Record<
  string,
  Pick<ModelConfig, "baseUrl" | "model">
> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
  },
  glm: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.2",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
  },
};

export function loadModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): ModelConfig | null {
  const provider = normalizeProvider(env.CODEMUSE_PROVIDER || "deepseek");
  const apiKey = env.CODEMUSE_API_KEY?.trim();
  if (!apiKey) return null;

  const preset = MODEL_PRESETS[provider];
  const baseUrl = env.CODEMUSE_BASE_URL?.trim() || preset?.baseUrl;
  const model = env.CODEMUSE_MODEL?.trim() || preset?.model;
  if (!baseUrl || !model) {
    throw new Error(
      `自定义 Provider ${provider} 必须同时配置 CODEMUSE_BASE_URL 和 CODEMUSE_MODEL`,
    );
  }

  return {
    provider,
    apiKey,
    baseUrl: normalizeBaseUrl(baseUrl),
    model: validateModelName(model),
    ...(env.CODEMUSE_TIMEOUT_MS
      ? { timeoutMs: parseInteger(env.CODEMUSE_TIMEOUT_MS, "CODEMUSE_TIMEOUT_MS", 5_000, 120_000) }
      : {}),
    ...(env.CODEMUSE_MAX_RETRIES
      ? { maxRetries: parseInteger(env.CODEMUSE_MAX_RETRIES, "CODEMUSE_MAX_RETRIES", 0, 5) }
      : {}),
  };
}

export function isMockRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.CODEMUSE_MOCK?.toLowerCase();
  return value === "1" || value === "true";
}

export function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("模型 Base URL 必须是有效 URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("模型 Base URL 只允许 http 或 https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("模型 Base URL 不能包含用户名或密码");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("模型 Base URL 不能包含查询参数或片段");
  }
  return value.replace(/\/+$/, "");
}

export function validateModelName(value: string): string {
  const model = value.trim();
  if (!model || model.length > 200 || /[\u0000-\u001f\u007f]/.test(model)) {
    throw new Error("模型名称必须是 1 到 200 个可见字符");
  }
  return model;
}

export function normalizeProvider(value: string): string {
  const provider = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,49}$/.test(provider)) {
    throw new Error("Provider 名称格式无效");
  }
  return provider;
}

function parseInteger(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return parsed;
}
