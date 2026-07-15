import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelAgent } from "../src/agent/model-agent.ts";
import { openWorkspace } from "../src/context/workspace.ts";
import { scanProject } from "../src/context/project-scanner.ts";
import { createReadOnlyToolRegistry } from "../src/tools/create-read-only-tools.ts";
import { SessionRecorder } from "../src/sessions/session-recorder.ts";
import {
  createAgentResumeContext,
  SessionStore,
} from "../src/sessions/session-store.ts";
import type {
  AgentResumeContext,
  AgentSessionState,
  ChatMessage,
  ModelProvider,
  ModelStreamEvent,
  ToolDefinition,
} from "../src/types.ts";

const signal = new AbortController().signal;

test("SessionRecorder 清除 API Key 且不保存 Diff 和命令输出", () => {
  const secret = "sk-session-secret-123456";
  const recorder = new SessionRecorder(
    `修复任务 CODEMUSE_API_KEY=${secret}`,
    "fake/model",
    "model",
    [secret],
  );
  recorder.recordApproval({
    id: "approval",
    kind: "write",
    title: "确认修改 src/index.ts",
    summary: "应用补丁",
    paths: ["src/index.ts"],
    diff: `+ const key = "${secret}";`,
  }, "approved");
  recorder.recordEvent({
    type: "command-output",
    content: `Authorization: Bearer ${secret}`,
  });
  recorder.recordEvent({
    type: "model-usage",
    model: "fake/model",
    usage: {
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
    },
  });
  recorder.recordEvent({ type: "complete", summary: "任务完成" });

  const state = emptyState();
  state.plan = {
    task: `检查 ${secret}`,
    steps: [{
      id: "respond",
      title: `报告 ${secret}`,
      status: "completed",
    }],
  };
  const serialized = JSON.stringify(recorder.toDraft(state, false));
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, /const key/);
  assert.doesNotMatch(serialized, /Authorization/);
  assert.match(serialized, /\[REDACTED\]/);
  assert.match(serialized, /"kind":"usage"/);
  assert.match(serialized, /合计 12 Tokens/);
});

test("SessionStore 保存、列出并恢复未变化的工作区", async () => {
  const root = await createWorkspace("session-roundtrip");
  try {
    const recorder = new SessionRecorder("分析入口文件", "mock", "mock");
    recorder.recordEvent({
      type: "tool-complete",
      id: "read",
      name: "read_file",
      summary: "读取 src/index.ts:1-2",
    });
    recorder.recordEvent({ type: "complete", summary: "分析完成" });

    const store = new SessionStore(root);
    const draft = recorder.toDraft(sampleState(), false);
    await assert.rejects(
      store.save({ ...draft, id: "../escape" }, signal),
      /会话 ID必须是合法 UUID|会话 ID 必须是合法 UUID/,
    );
    const saved = await store.save(draft, signal);
    const history = await store.list();

    assert.equal(history.length, 1);
    assert.equal(history[0]?.id, saved.id);
    assert.equal(history[0]?.task, "分析入口文件");

    const loaded = await store.load(saved.id.slice(0, 8));
    assert.equal(loaded.id, saved.id);
    assert.equal(loaded.activities[0]?.name, "read_file");

    const resumed = await store.resume(saved.id.slice(0, 8), signal);
    assert.equal(resumed.checkpoint.fingerprint, saved.checkpoint.fingerprint);

    const workspace = await openWorkspace(root);
    const project = await scanProject(workspace, signal);
    assert.ok(!project.files.some((path) => path.startsWith(".codemuse/")));

    const sessionFile = join(root, ".codemuse", "sessions", `${saved.id}.json`);
    const sessionText = await readFile(sessionFile, "utf8");
    assert.match(sessionText, /"schemaVersion": 1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SessionStore 在工作区变化后拒绝恢复旧上下文", async () => {
  const root = await createWorkspace("session-changed");
  try {
    const recorder = new SessionRecorder("检查代码", "mock", "mock");
    recorder.recordEvent({ type: "complete", summary: "检查完成" });
    const store = new SessionStore(root);
    const draft = recorder.toDraft(sampleState(), false);
    await assert.rejects(
      store.save({ ...draft, id: "../escape" }, signal),
      /会话 ID必须是合法 UUID|会话 ID 必须是合法 UUID/,
    );
    const saved = await store.save(draft, signal);

    await writeFile(
      join(root, "src", "index.ts"),
      "export const value = 200;\n",
      "utf8",
    );

    await assert.rejects(
      store.resume(saved.id, signal),
      /工作区.*已经变化/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class ResumeProvider implements ModelProvider {
  readonly name = "fake/resume-model";
  receivedMessages: ChatMessage[] = [];

  async *stream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    _signal: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent> {
    this.receivedMessages = structuredClone(messages);
    assert.equal(tools.length, 3);
    yield { type: "text-delta", content: "已根据恢复信息继续分析。" };
  }
}

test("ModelAgent 将恢复摘要作为不可信背景加入下一任务", async () => {
  const root = await createWorkspace("session-agent");
  try {
    const provider = new ResumeProvider();
    const agent = new ModelAgent(
      provider,
      createReadOnlyToolRegistry(),
      500,
    );
    const resume: AgentResumeContext = {
      sessionId: "12345678-1234-4123-8123-123456789abc",
      createdAt: "2026-07-15T10:00:00.000Z",
      priorTask: "修复登录测试",
      status: "failed",
      summary: "typecheck 未通过",
      priorPlan: [{
        id: "analyze",
        title: "分析错误",
        status: "failed",
      }],
      recentActivities: ["tool | run_script | failed | 退出码 2"],
    };

    for await (const _event of agent.run("继续检查剩余错误", {
      signal,
      workspace: root,
      resume,
    })) {
      // Drain the event stream.
    }

    const userMessage = provider.receivedMessages.find((message) =>
      message.role === "user"
    );
    assert.match(userMessage?.content ?? "", /恢复的历史会话/);
    assert.match(userMessage?.content ?? "", /修复登录测试/);
    assert.match(userMessage?.content ?? "", /所有结论必须重新验证/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createAgentResumeContext 只选择有限的最近活动", () => {
  const recorder = new SessionRecorder("任务", "mock", "mock");
  for (let index = 0; index < 30; index += 1) {
    recorder.recordEvent({
      type: "notice",
      message: `记录 ${index}`,
    });
  }
  recorder.recordEvent({ type: "complete", summary: "完成" });
  const draft = recorder.toDraft(sampleState(), false);
  const context = createAgentResumeContext({
    ...draft,
    schemaVersion: 1,
    updatedAt: draft.createdAt,
    workspaceRoot: "C:/workspace",
    checkpoint: {
      fingerprint: "a".repeat(64),
      fileCount: 2,
      truncated: false,
    },
  });

  assert.equal(context.recentActivities.length, 10);
  assert.ok(context.recentActivities.every((item) => item.length <= 400));
  assert.match(context.recentActivities.at(-1) ?? "", /完成/);
});

async function createWorkspace(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `codemuse-${name}-`));
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name, scripts: { test: "node test.js" } }),
    "utf8",
  );
  await writeFile(
    join(root, "src", "index.ts"),
    "export const value = 1;\n",
    "utf8",
  );
  return root;
}

function sampleState(): AgentSessionState {
  return {
    project: {
      projectName: "fixture",
      projectTypes: ["Node.js", "TypeScript"],
      languages: ["TypeScript"],
      frameworks: [],
      packageManager: "npm",
      fileCount: 2,
      files: ["package.json", "src/index.ts"],
      keyFiles: ["package.json"],
      truncated: false,
    },
    plan: {
      task: "分析入口文件",
      steps: [
        { id: "scan", title: "扫描项目", status: "completed" },
        { id: "respond", title: "返回结果", status: "completed" },
      ],
    },
    context: null,
  };
}

function emptyState(): AgentSessionState {
  return { project: null, plan: null, context: null };
}
