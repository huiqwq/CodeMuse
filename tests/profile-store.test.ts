import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  initializeProfileConfig,
  loadModelCatalog,
} from "../src/models/profile-store.ts";

test("初始化本机模型配置模板且不写入 API Key", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemuse-profile-init-"));
  try {
    const path = join(root, "config.json");
    const env = { CODEMUSE_CONFIG_PATH: path };
    const first = await initializeProfileConfig(env);
    const second = await initializeProfileConfig(env);
    const text = await readFile(path, "utf8");

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.match(text, /"apiKeyEnv": "DEEPSEEK_API_KEY"/);
    assert.doesNotMatch(text, /"apiKey"\s*:/);

    const catalog = await loadModelCatalog(env);
    assert.equal(catalog.configExists, true);
    assert.equal(catalog.activeProfile, "deepseek");
    assert.ok(catalog.profiles.some((profile) => profile.name === "openai"));
    assert.equal(
      catalog.profiles.find((profile) => profile.name === "glm")?.model,
      "glm-5.2",
    );
    assert.equal(
      catalog.profiles.find((profile) => profile.name === "glm-flash")?.model,
      "glm-4.7-flash",
    );
    assert.equal(
      catalog.profiles.find((profile) => profile.name === "glm-flash")
        ?.apiKeyEnv,
      "ZHIPUAI_API_KEY",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("配置文件加载多个 Profile 并从独立环境变量解析 Key", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemuse-profile-load-"));
  try {
    const path = join(root, "config.json");
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      activeProfile: "campus-glm",
      profiles: [
        {
          name: "campus-glm",
          provider: "glm",
          baseUrl: "https://open.bigmodel.cn/api/paas/v4",
          model: "glm-campus",
          apiKeyEnv: "CAMPUS_GLM_API_KEY",
          timeoutMs: 20_000,
          maxRetries: 1,
        },
        {
          name: "lab-custom",
          provider: "custom",
          baseUrl: "https://models.example.test/v1",
          model: "lab-model",
          apiKeyEnv: "LAB_MODEL_API_KEY",
        },
      ],
    }), "utf8");

    const catalog = await loadModelCatalog({
      CODEMUSE_CONFIG_PATH: path,
      CAMPUS_GLM_API_KEY: "glm-secret",
      LAB_MODEL_API_KEY: "custom-secret",
    });
    const glm = catalog.profiles.find((profile) =>
      profile.name === "campus-glm"
    );

    assert.equal(catalog.activeProfile, "campus-glm");
    assert.equal(glm?.configured, true);
    assert.equal(glm?.config?.apiKey, "glm-secret");
    assert.equal(glm?.config?.timeoutMs, 20_000);
    assert.doesNotMatch(JSON.stringify(catalog.profiles.map((profile) => ({
      name: profile.name,
      configured: profile.configured,
    }))), /glm-secret/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("配置文件拒绝明文 API Key 和未知活动 Profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemuse-profile-invalid-"));
  try {
    const path = join(root, "config.json");
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      activeProfile: "custom",
      profiles: [{
        name: "custom",
        provider: "custom",
        baseUrl: "https://example.test/v1",
        model: "model",
        apiKeyEnv: "CUSTOM_API_KEY",
        apiKey: "must-not-be-here",
      }],
    }), "utf8");

    await assert.rejects(
      loadModelCatalog({ CODEMUSE_CONFIG_PATH: path }),
      /未知字段.*API Key/,
    );

    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      activeProfile: "missing",
      profiles: [],
    }), "utf8");
    await assert.rejects(
      loadModelCatalog({ CODEMUSE_CONFIG_PATH: path }),
      /activeProfile 不存在/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("旧 CODEMUSE_API_KEY 配置保持兼容", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemuse-profile-legacy-"));
  try {
    const catalog = await loadModelCatalog({
      CODEMUSE_CONFIG_PATH: join(root, "missing.json"),
      CODEMUSE_PROVIDER: "deepseek",
      CODEMUSE_API_KEY: "legacy-secret",
    });
    const active = catalog.profiles.find((profile) =>
      profile.name === catalog.activeProfile
    );

    assert.equal(catalog.activeProfile, "environment");
    assert.equal(active?.source, "environment");
    assert.equal(active?.config?.apiKey, "legacy-secret");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
