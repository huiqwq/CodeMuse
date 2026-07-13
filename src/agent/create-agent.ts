import { MockAgent } from "./mock-agent.ts";
import { ModelAgent } from "./model-agent.ts";
import { loadContextTokenBudget } from "../context/token-budget.ts";
import { CompatibleProvider } from "../models/compatible-provider.ts";
import { isMockRequested, loadModelConfig } from "../models/config.ts";
import { createCodingToolRegistry } from "../tools/create-coding-tools.ts";
import type { AgentRunner } from "../types.ts";

export function createAgent(env: NodeJS.ProcessEnv = process.env): AgentRunner {
  const config = loadModelConfig(env);
  const contextTokenBudget = loadContextTokenBudget(env);
  const tools = createCodingToolRegistry();

  if (!config || isMockRequested(env)) {
    return new MockAgent(contextTokenBudget, tools);
  }

  return new ModelAgent(
    new CompatibleProvider(config),
    tools,
    contextTokenBudget,
  );
}
