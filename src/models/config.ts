import type { ModelConfig } from "../types.ts";

const PRESETS: Record<string, Pick<ModelConfig, "baseUrl" | "model">> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
  },
  glm: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
  },
};

export function loadModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): ModelConfig | null {
  const provider = (env.CODEMUSE_PROVIDER || "deepseek").toLowerCase();
  const apiKey = env.CODEMUSE_API_KEY?.trim();

  if (!apiKey) return null;

  const preset = PRESETS[provider] ?? PRESETS.deepseek;
  return {
    provider,
    apiKey,
    baseUrl: removeTrailingSlash(env.CODEMUSE_BASE_URL || preset.baseUrl),
    model: env.CODEMUSE_MODEL || preset.model,
  };
}

export function isMockRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEMUSE_MOCK === "1" || env.CODEMUSE_MOCK === "true";
}

function removeTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
