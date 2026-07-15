import { ManagedAgent } from "./managed-agent.ts";
import { loadContextTokenBudget } from "../context/token-budget.ts";
import { loadModelCatalog } from "../models/profile-store.ts";
import { createCodingToolRegistry } from "../tools/create-coding-tools.ts";
import { createCredentialStore } from "../credentials/credential-store.ts";

export async function createAgent(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ManagedAgent> {
  const credentialStore = createCredentialStore(env);
  const loadCredentials = () => credentialStore.load();
  return new ManagedAgent(
    await loadModelCatalog(env, await loadCredentials()),
    env,
    loadContextTokenBudget(env),
    createCodingToolRegistry(),
    undefined,
    loadCredentials,
  );
}
