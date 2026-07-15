import { ManagedAgent } from "./managed-agent.ts";
import { loadContextTokenBudget } from "../context/token-budget.ts";
import { loadModelCatalog } from "../models/profile-store.ts";
import { createCodingToolRegistry } from "../tools/create-coding-tools.ts";

export async function createAgent(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ManagedAgent> {
  return new ManagedAgent(
    await loadModelCatalog(env),
    env,
    loadContextTokenBudget(env),
    createCodingToolRegistry(),
  );
}
