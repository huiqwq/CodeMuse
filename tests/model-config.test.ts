import assert from "node:assert/strict";
import test from "node:test";
import { loadModelConfig } from "../src/models/config.ts";

test("没有 API Key 时使用本地 Mock 模式", () => {
  assert.equal(loadModelConfig({}), null);
});

test("加载 GLM 预设并允许覆盖模型", () => {
  const preset = loadModelConfig({
    CODEMUSE_PROVIDER: "glm",
    CODEMUSE_API_KEY: "secret",
  });
  assert.equal(preset?.model, "glm-5.2");

  const config = loadModelConfig({
    CODEMUSE_PROVIDER: "glm",
    CODEMUSE_API_KEY: "secret",
    CODEMUSE_MODEL: "glm-test",
  });
  assert.deepEqual(config, {
    provider: "glm",
    apiKey: "secret",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-test",
  });
});

test("加载 OpenAI 预设和请求策略", () => {
  const config = loadModelConfig({
    CODEMUSE_PROVIDER: "openai",
    CODEMUSE_API_KEY: "secret",
    CODEMUSE_TIMEOUT_MS: "15000",
    CODEMUSE_MAX_RETRIES: "3",
  });
  assert.deepEqual(config, {
    provider: "openai",
    apiKey: "secret",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    timeoutMs: 15_000,
    maxRetries: 3,
  });
});

test("自定义 Provider 必须提供 Base URL 和模型", () => {
  assert.throws(
    () => loadModelConfig({
      CODEMUSE_PROVIDER: "custom",
      CODEMUSE_API_KEY: "secret",
    }),
    /必须同时配置/,
  );
  assert.throws(
    () => loadModelConfig({
      CODEMUSE_PROVIDER: "custom",
      CODEMUSE_API_KEY: "secret",
      CODEMUSE_BASE_URL: "file:///unsafe",
      CODEMUSE_MODEL: "custom-model",
    }),
    /只允许 http 或 https/,
  );
});
