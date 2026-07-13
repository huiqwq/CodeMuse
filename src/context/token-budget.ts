const DEFAULT_CONTEXT_TOKENS = 6_000;
const MIN_CONTEXT_TOKENS = 500;
const MAX_CONTEXT_TOKENS = 100_000;

export function loadContextTokenBudget(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CODEMUSE_CONTEXT_TOKENS?.trim();
  if (!raw) return DEFAULT_CONTEXT_TOKENS;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_CONTEXT_TOKENS || value > MAX_CONTEXT_TOKENS) {
    return DEFAULT_CONTEXT_TOKENS;
  }
  return value;
}

export function estimateTokens(value: string): number {
  let cjkCharacters = 0;
  let otherCharacters = 0;

  for (const character of value) {
    if (/\p{Script=Han}/u.test(character)) cjkCharacters += 1;
    else otherCharacters += 1;
  }

  return cjkCharacters + Math.ceil(otherCharacters / 4);
}

export function truncateToTokenBudget(
  value: string,
  budgetTokens: number,
): { content: string; estimatedTokens: number; truncated: boolean } {
  if (budgetTokens <= 0) {
    return { content: "", estimatedTokens: 0, truncated: value.length > 0 };
  }

  const currentTokens = estimateTokens(value);
  if (currentTokens <= budgetTokens) {
    return { content: value, estimatedTokens: currentTokens, truncated: false };
  }

  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTokens(value.slice(0, middle)) <= budgetTokens) low = middle;
    else high = middle - 1;
  }

  const marker = "\n...内容已按 Token 预算截断";
  const markerTokens = estimateTokens(marker);
  const contentBudget = Math.max(0, budgetTokens - markerTokens);
  let markerEnd = 0;
  let markerStart = low;
  while (markerEnd < markerStart) {
    const middle = Math.ceil((markerEnd + markerStart) / 2);
    if (estimateTokens(value.slice(0, middle)) <= contentBudget) markerEnd = middle;
    else markerStart = middle - 1;
  }

  const content = markerTokens < budgetTokens
    ? `${value.slice(0, markerEnd)}${marker}`
    : value.slice(0, low);

  return {
    content,
    estimatedTokens: estimateTokens(content),
    truncated: true,
  };
}
