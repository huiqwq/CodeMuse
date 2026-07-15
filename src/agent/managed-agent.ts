import { MockAgent } from "./mock-agent.ts";
import { ModelAgent } from "./model-agent.ts";
import { CompatibleProvider } from "../models/compatible-provider.ts";
import {
  initializeProfileConfig,
  loadModelCatalog,
  type ModelCatalog,
  type ResolvedModelProfile,
} from "../models/profile-store.ts";
import { isMockRequested } from "../models/config.ts";
import type { ToolRegistry } from "../tools/registry.ts";
import type {
  AgentEvent,
  AgentRunOptions,
  AgentRunner,
  AgentSessionState,
  ModelConfig,
  ModelUsage,
  ProjectScan,
  UndoResult,
} from "../types.ts";

export type ModelProfileSummary = {
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  configured: boolean;
  source: ResolvedModelProfile["source"] | "mock";
  active: boolean;
};

export type ModelSwitchResult = {
  profile: string;
  modelName: string;
  mode: "mock" | "model";
  message: string;
};

export type ManagedConnectionResult = {
  success: boolean;
  profile: string;
  provider: string;
  model: string;
  latencyMs: number;
  attempts: number;
  usage: ModelUsage | null;
  message: string;
};

export type UsageSummary = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  byModel: Array<{
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>;
};

type ProviderFactory = (config: ModelConfig) => CompatibleProvider;

export class ManagedAgent implements AgentRunner {
  private catalog: ModelCatalog;
  private readonly env: NodeJS.ProcessEnv;
  private readonly contextTokenBudget: number;
  private readonly tools: ToolRegistry;
  private readonly providerFactory: ProviderFactory;
  private delegate: AgentRunner;
  private activeProfileName: string;
  private readonly usage = new Map<string, ModelUsage>();

  constructor(
    catalog: ModelCatalog,
    env: NodeJS.ProcessEnv,
    contextTokenBudget: number,
    tools: ToolRegistry,
    providerFactory: ProviderFactory = (config) => new CompatibleProvider(config),
  ) {
    this.catalog = catalog;
    this.env = env;
    this.contextTokenBudget = contextTokenBudget;
    this.tools = tools;
    this.providerFactory = providerFactory;
    this.activeProfileName = isMockRequested(env)
      ? "mock"
      : catalog.activeProfile;
    this.delegate = this.createDelegate(this.activeProfileName);
  }

  get mode(): "mock" | "model" {
    return this.delegate.mode;
  }

  get modelName(): string {
    return this.delegate.modelName;
  }

  get configPath(): string {
    return this.catalog.configPath;
  }

  async *run(
    task: string,
    options: AgentRunOptions,
  ): AsyncGenerator<AgentEvent> {
    for await (const event of this.delegate.run(task, options)) {
      if (event.type === "model-usage") {
        this.addUsage(event.model, event.usage);
      }
      yield event;
    }
  }

  scan(options: AgentRunOptions): Promise<ProjectScan> {
    return this.delegate.scan(options);
  }

  undo(options: AgentRunOptions): Promise<UndoResult> {
    return this.delegate.undo(options);
  }

  getState(): AgentSessionState {
    return this.delegate.getState();
  }

  restoreState(state: AgentSessionState): void {
    this.delegate.restoreState(state);
  }

  clearState(): void {
    this.delegate.clearState();
  }

  listProfiles(): ModelProfileSummary[] {
    const profiles: ModelProfileSummary[] = [{
      name: "mock",
      provider: "local",
      model: "deterministic-demo",
      baseUrl: "local",
      apiKeyEnv: "-",
      configured: true,
      source: "mock",
      active: this.activeProfileName === "mock",
    }];
    for (const profile of this.catalog.profiles) {
      profiles.push({
        name: profile.name,
        provider: profile.provider,
        model: profile.model,
        baseUrl: profile.baseUrl,
        apiKeyEnv: profile.apiKeyEnv,
        configured: profile.configured,
        source: profile.source,
        active: this.activeProfileName === profile.name,
      });
    }
    return profiles;
  }

  switchProfile(name: string): ModelSwitchResult {
    const profileName = name.trim().toLowerCase();
    if (!profileName) throw new Error("必须指定要切换的 Profile");
    if (profileName !== "mock") {
      const profile = this.catalog.profiles.find((item) =>
        item.name === profileName
      );
      if (!profile) throw new Error(`不存在模型 Profile：${profileName}`);
      if (!profile.config) {
        throw new Error(
          `Profile ${profileName} 未配置 API Key，请设置环境变量 ${profile.apiKeyEnv}`,
        );
      }
    }

    const state = this.delegate.getState();
    this.activeProfileName = profileName;
    this.delegate = this.createDelegate(profileName);
    this.delegate.restoreState(state);
    return {
      profile: profileName,
      modelName: this.modelName,
      mode: this.mode,
      message: `已切换到 ${profileName}`,
    };
  }

  async reloadProfiles(): Promise<ModelSwitchResult> {
    const state = this.delegate.getState();
    this.catalog = await loadModelCatalog(this.env);
    const current = this.activeProfileName;
    const currentAvailable = current === "mock" ||
      this.catalog.profiles.some((profile) =>
        profile.name === current && profile.configured
      );
    this.activeProfileName = currentAvailable
      ? current
      : this.catalog.activeProfile;
    this.delegate = this.createDelegate(this.activeProfileName);
    this.delegate.restoreState(state);
    return {
      profile: this.activeProfileName,
      modelName: this.modelName,
      mode: this.mode,
      message: "模型配置已重新加载",
    };
  }

  async initializeConfig(): Promise<{ path: string; created: boolean }> {
    const result = await initializeProfileConfig(this.env);
    await this.reloadProfiles();
    return result;
  }

  async testConnection(
    name: string | undefined,
    signal: AbortSignal,
  ): Promise<ManagedConnectionResult> {
    const profileName = (name?.trim().toLowerCase() || this.activeProfileName);
    if (profileName === "mock") {
      return {
        success: true,
        profile: "mock",
        provider: "local",
        model: "deterministic-demo",
        latencyMs: 0,
        attempts: 1,
        usage: null,
        message: "Mock 模式无需网络连接",
      };
    }

    const profile = this.catalog.profiles.find((item) =>
      item.name === profileName
    );
    if (!profile) throw new Error(`不存在模型 Profile：${profileName}`);
    if (!profile.config) {
      throw new Error(
        `Profile ${profileName} 未配置 API Key，请设置环境变量 ${profile.apiKeyEnv}`,
      );
    }

    const startedAt = Date.now();
    try {
      const result = await this.providerFactory(profile.config)
        .testConnection(signal);
      return {
        success: true,
        profile: profile.name,
        ...result,
      };
    } catch (error) {
      return {
        success: false,
        profile: profile.name,
        provider: profile.provider,
        model: profile.model,
        latencyMs: Date.now() - startedAt,
        attempts: 0,
        usage: null,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getUsage(): UsageSummary {
    const byModel = [...this.usage.entries()].map(([model, usage]) => ({
      model,
      ...usage,
    }));
    return {
      promptTokens: byModel.reduce((sum, item) => sum + item.promptTokens, 0),
      completionTokens: byModel.reduce(
        (sum, item) => sum + item.completionTokens,
        0,
      ),
      totalTokens: byModel.reduce((sum, item) => sum + item.totalTokens, 0),
      byModel,
    };
  }

  getSecrets(): string[] {
    return this.catalog.profiles
      .map((profile) => profile.config?.apiKey)
      .filter((value): value is string => Boolean(value));
  }

  private createDelegate(profileName: string): AgentRunner {
    if (profileName === "mock" || isMockRequested(this.env)) {
      return new MockAgent(
        this.contextTokenBudget,
        this.tools,
        "Mock（多模型配置与 API 管理演示）",
      );
    }
    const profile = this.catalog.profiles.find((item) =>
      item.name === profileName
    );
    if (!profile?.config) {
      const keyName = profile?.apiKeyEnv ?? "对应 API Key 环境变量";
      return new MockAgent(
        this.contextTokenBudget,
        this.tools,
        `Mock（Profile ${profileName} 缺少 ${keyName}）`,
      );
    }
    return new ModelAgent(
      this.providerFactory(profile.config),
      this.tools,
      this.contextTokenBudget,
    );
  }

  private addUsage(model: string, value: ModelUsage): void {
    const current = this.usage.get(model) ?? {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    current.promptTokens += value.promptTokens;
    current.completionTokens += value.completionTokens;
    current.totalTokens += value.totalTokens;
    this.usage.set(model, current);
  }
}
