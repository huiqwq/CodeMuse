import assert from "node:assert/strict";
import test from "node:test";
import { loadModelConfig } from "../src/models/config.ts";

test("没有 API Key 时使用本地 Mock 模式", () => {
  assert.equal(loadModelConfig({}), null);
});

test("加载 GLM 预设并允许覆盖模型", () => {
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
