import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ManagedAgent } from "../src/agent/managed-agent.ts";
import { CompatibleProvider } from "../src/models/compatible-provider.ts";
import { createReadOnlyToolRegistry } from "../src/tools/create-read-only-tools.ts";
import type {
  ModelCatalog,
  ResolvedModelProfile,
} from "../src/models/profile-store.ts";
import type {
  ModelConfig,
  ModelStreamEvent,
  ToolDefinition,
  ChatMessage,
} from "../src/types.ts";

class FakeCompatibleProvider extends CompatibleProvider {
  private readonly fakeConfig: ModelConfig;

  constructor(config: ModelConfig) {
    super(config);
    this.fakeConfig = config;
  }

  override async *stream(
    _messages: ChatMessage[],
    _tools: ToolDefinition[],
    _signal: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent> {
    yield {
      type: "provider-notice",
      message: "模型请求在第 2 次尝试后成功",
    };
    yield {
      type: "usage",
      usage: {
        promptTokens: 40,
        completionTokens: 5,
        totalTokens: 45,
      },
    };
    yield {
      type: "text-delta",
      content: `由 ${this.fakeConfig.model} 完成分析。`,
    };
    yield { type: "finish", reason: "stop" };
  }

  override async testConnection() {
    return {
      provider: this.fakeConfig.provider,
      model: this.fakeConfig.model,
      latencyMs: 5,
      attempts: 1,
      usage: {
        promptTokens: 2,
        completionTokens: 1,
        totalTokens: 3,
      },
      message: "模型连接测试成功",
    };
  }
}

test("ManagedAgent 切换模型时保留状态并累计 Token", async () => {
  const root = await createWorkspace();
  try {
    const catalog = createCatalog();
    const agent = new ManagedAgent(
      catalog,
      {},
      500,
      createReadOnlyToolRegistry(),
      (config) => new FakeCompatibleProvider(config),
    );

    assert.equal(agent.modelName, "alpha/alpha-model");
    assert.equal(agent.getSecrets().length, 2);
    assert.doesNotMatch(
      JSON.stringify(agent.listProfiles()),
      /alpha-secret|beta-secret/,
    );

    const events = [];
    for await (const event of agent.run("分析入口", {
      signal: new AbortController().signal,
      workspace: root,
    })) {
      events.push(event);
    }

    assert.ok(events.some((event) => event.type === "model-usage"));
    assert.ok(events.some((event) =>
      event.type === "notice" && event.message.includes("第 2 次")
    ));
    assert.equal(agent.getUsage().totalTokens, 45);
    assert.ok(agent.getState().plan);

    const switched = agent.switchProfile("beta");
    assert.equal(switched.mode, "model");
    assert.equal(agent.modelName, "beta/beta-model");
    assert.ok(agent.getState().plan);

    const connection = await agent.testConnection(
      "beta",
      new AbortController().signal,
    );
    assert.equal(connection.success, true);
    assert.equal(connection.usage?.totalTokens, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ManagedAgent 拒绝切换到缺少 API Key 的 Profile", () => {
  const catalog = createCatalog();
  catalog.profiles.push(profile({
    name: "missing",
    provider: "custom",
    model: "missing-model",
    apiKeyEnv: "MISSING_API_KEY",
    configured: false,
    config: null,
  }));
  const agent = new ManagedAgent(
    catalog,
    {},
    500,
    createReadOnlyToolRegistry(),
    (config) => new FakeCompatibleProvider(config),
  );

  assert.throws(
    () => agent.switchProfile("missing"),
    /MISSING_API_KEY/,
  );
  assert.equal(agent.switchProfile("mock").mode, "mock");
});

function createCatalog(): ModelCatalog {
  return {
    configPath: "C:/test/.codemuse/config.json",
    activeProfile: "alpha",
    configExists: true,
    profiles: [
      profile({
        name: "alpha",
        provider: "alpha",
        model: "alpha-model",
        apiKeyEnv: "ALPHA_API_KEY",
        configured: true,
        config: {
          provider: "alpha",
          apiKey: "alpha-secret",
          baseUrl: "https://alpha.example.test/v1",
          model: "alpha-model",
        },
      }),
      profile({
        name: "beta",
        provider: "beta",
        model: "beta-model",
        apiKeyEnv: "BETA_API_KEY",
        configured: true,
        config: {
          provider: "beta",
          apiKey: "beta-secret",
          baseUrl: "https://beta.example.test/v1",
          model: "beta-model",
        },
      }),
    ],
  };
}

function profile(
  overrides: Partial<ResolvedModelProfile> &
    Pick<ResolvedModelProfile, "name" | "provider" | "model" | "apiKeyEnv" | "configured" | "config">,
): ResolvedModelProfile {
  return {
    baseUrl: `https://${overrides.provider}.example.test/v1`,
    source: "file",
    ...overrides,
  };
}

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codemuse-managed-agent-"));
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "managed-agent-fixture" }),
    "utf8",
  );
  await writeFile(
    join(root, "src", "index.ts"),
    "export const value = 1;\n",
    "utf8",
  );
  return root;
}
