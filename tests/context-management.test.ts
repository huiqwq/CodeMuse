import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { MockAgent } from "../src/agent/mock-agent.ts";
import { selectTaskContext } from "../src/context/context-selector.ts";
import { scanProject } from "../src/context/project-scanner.ts";
import {
  estimateTokens,
  loadContextTokenBudget,
  truncateToTokenBudget,
} from "../src/context/token-budget.ts";
import { openWorkspace } from "../src/context/workspace.ts";

const fixture = resolve("tests/fixtures/sample-project");

test("项目扫描识别技术栈并排除构建目录", async () => {
  const workspace = await openWorkspace(fixture);
  const project = await scanProject(workspace, new AbortController().signal);

  assert.equal(project.projectName, "sample-project");
  assert.ok(project.projectTypes.includes("Node.js"));
  assert.ok(project.projectTypes.includes("TypeScript"));
  assert.ok(project.languages.includes("TypeScript"));
  assert.ok(project.keyFiles.includes("package.json"));
  assert.ok(!project.files.some((path) => path.startsWith("build/")));
});

test("上下文选择包含相关代码并遵守 Token 预算", async () => {
  const workspace = await openWorkspace(fixture);
  const signal = new AbortController().signal;
  const project = await scanProject(workspace, signal);
  const selection = await selectTaskContext(
    "Explain the add function implementation",
    project,
    workspace,
    500,
    signal,
  );
  const paths = selection.summary.files.map((file) => file.path);

  assert.ok(paths.includes("src/utils.ts"));
  assert.match(selection.modelContent, /export function add/);
  assert.ok(selection.summary.estimatedTokens <= 500);
  assert.ok(selection.summary.files.every((file) => !("content" in file)));
});

test("Token 估算兼顾中英文并能安全截断", () => {
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("代码"), 2);

  const result = truncateToTokenBudget("代码".repeat(100), 30);
  assert.equal(result.truncated, true);
  assert.ok(result.estimatedTokens <= 30);
  assert.ok(result.content.length > 0);
});

test("上下文预算允许配置并拒绝无效值", () => {
  assert.equal(loadContextTokenBudget({ CODEMUSE_CONTEXT_TOKENS: "1200" }), 1200);
  assert.equal(loadContextTokenBudget({ CODEMUSE_CONTEXT_TOKENS: "10" }), 6000);
  assert.equal(loadContextTokenBudget({ CODEMUSE_CONTEXT_TOKENS: "invalid" }), 6000);
});

test("Mock Agent 完成扫描、规划和上下文选择", async () => {
  const agent = new MockAgent(500);
  const events = [];

  for await (const event of agent.run("分析 add 函数", {
    signal: new AbortController().signal,
    workspace: fixture,
  })) {
    events.push(event);
  }

  const state = agent.getState();
  assert.ok(events.some((event) => event.type === "project-scanned"));
  assert.ok(events.some((event) => event.type === "plan-updated"));
  assert.ok(events.some((event) => event.type === "context-selected"));
  assert.ok(state.context?.files.some((file) => file.path === "src/utils.ts"));
  assert.ok(state.plan?.steps.every((step) => step.status === "completed"));
});
