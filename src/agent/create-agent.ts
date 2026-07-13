import { MockAgent } from "./mock-agent.ts";
import { ModelAgent } from "./model-agent.ts";
import { CompatibleProvider } from "../models/compatible-provider.ts";
import { isMockRequested, loadModelConfig } from "../models/config.ts";
import { createReadOnlyToolRegistry } from "../tools/create-read-only-tools.ts";
import type { AgentRunner } from "../types.ts";

export function createAgent(env: NodeJS.ProcessEnv = process.env): AgentRunner {
  const config = loadModelConfig(env);
  const tools = createReadOnlyToolRegistry();
  if (!config || isMockRequested(env)) return new MockAgent(tools);
  return new ModelAgent(new CompatibleProvider(config), tools);
}
