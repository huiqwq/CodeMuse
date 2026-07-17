#!/usr/bin/env node

import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { createAgent } from "./agent/create-agent.ts";
import { runAuthCommand } from "./credentials/auth-command.ts";
import {
  buildPastedReviewTask,
  buildReviewTask,
  PasteBuffer,
} from "./review/review-task.ts";
import {
  HELP_TEXT,
  parseSlashCommand,
  type SlashCommand,
} from "./commands/slash-command.ts";
import {
  handleAgentEvent,
  printApprovalRequest,
  printContextSummary,
  printConnectionResult,
  printDoctor,
  printGoal,
  printGoalHistory,
  printHeader,
  printMemories,
  printMemory,
  printModelProfiles,
  printPlan,
  printPlanArtifact,
  printProjectScan,
  printPrompt,
  printSessionHistory,
  printSessionRestored,
  printUsage,
  sanitizeTerminalText,
} from "./ui/terminal.ts";
import { color } from "./ui/colors.ts";
import { SessionRecorder } from "./sessions/session-recorder.ts";
import {
  createAgentResumeContext,
  SessionStore,
} from "./sessions/session-store.ts";
import type {
  AgentEvent,
  AgentResumeContext,
  AgentRunOptions,
  ApprovalDecision,
  ApprovalHandler,
  GoalRecord,
  PlanArtifact,
} from "./types.ts";
import { PlanStore, formatPlanExecutionTask } from "./planning/plan-store.ts";
import { GoalStore } from "./goals/goal-store.ts";
import { ProjectMemoryStore } from "./memory/project-memory-store.ts";
import { WorkspaceSettingsStore } from "./settings/workspace-settings.ts";
import { runDoctorChecks } from "./diagnostics/doctor.ts";
import { DiagnosticLogger } from "./diagnostics/logger.ts";

type PendingApproval = {
  id: string;
  resolve: (decision: ApprovalDecision) => void;
};

type TaskExecutionOptions = Pick<
  AgentRunOptions,
  "toolPolicy" | "contextMode" | "executionScope"
> & {
  recordedTask?: string;
  displayTask?: string;
  deferPrompt?: boolean;
};

type TaskRunResult = {
  response: string;
  summary: string;
  completed: boolean;
  verified: boolean;
  validationCommands: string[];
  totalTokens: number;
  runtimeMs: number;
};

const args = process.argv.slice(2);
if (args[0]?.toLowerCase() === "auth") {
  process.exitCode = await runAuthCommand(args.slice(1));
} else {
const workspace = resolve(args.find((arg) => !arg.startsWith("-")) || ".");
const agent = await createAgent();
const sessionStore = new SessionStore(workspace);
const planStore = new PlanStore(workspace);
const goalStore = new GoalStore(workspace);
const memoryStore = new ProjectMemoryStore(workspace);
const settingsStore = new WorkspaceSettingsStore(workspace);
let settings = await settingsStore.load().catch(() => ({
  approvalMode: "strict" as const,
  logLevel: "error" as const,
}));
const diagnosticLogger = new DiagnosticLogger(workspace, settings.logLevel);
let activePlan: PlanArtifact | null = await planStore.load().catch(() => null);
let activeGoal: GoalRecord | null = await goalStore.active().catch(() => null);
let planMode = false;
let executingPlan: PlanArtifact | null = null;
const readline = createInterface({ input, output, terminal: true });
let controller: AbortController | null = null;
let activeSessionRecorder: SessionRecorder | null = null;
let pendingResume: AgentResumeContext | null = null;
let pendingApproval: PendingApproval | null = null;
let exiting = false;
let pasteBuffer: PasteBuffer | null = null;
let lineQueue: Promise<void> = Promise.resolve();

printHeader(workspace, agent.modelName, agent.mode);
if (!agent.listProfiles().some((profile) => profile.configured)) {
  console.log(color.muted(
    "首次配置：使用 /model init 创建模型配置，或继续使用本地 mock；/doctor 可检查环境。",
  ));
}
if (activeGoal) {
  console.log(color.muted(
    `检测到可恢复 Goal ${activeGoal.id.slice(0, 8)}（${activeGoal.status}），使用 /goal status 查看。`,
  ));
}
printPrompt();

readline.on("SIGINT", () => {
  if (controller) {
    settleApproval("denied");
    controller.abort(new Error("用户取消任务"));
    return;
  }
  shutdown();
});

readline.on("line", (line) => {
  if (pendingApproval) {
    handleApprovalAnswer(line.trim());
    return;
  }
  lineQueue = lineQueue
    .then(() => processLine(line))
    .catch((error) => {
      console.log(color.error(
        `输入处理失败：${sanitizeTerminalText(errorMessage(error))}`,
      ));
      if (!exiting) printPrompt();
    });
});
readline.on("close", () => {
  if (!exiting) shutdown();
});

async function processLine(line: string): Promise<void> {
  if (pasteBuffer) {
    await handlePasteLine(line);
    return;
  }

  const value = line.trim();

  if (pendingApproval) {
    handleApprovalAnswer(value);
    return;
  }

  if (!value) {
    printPrompt();
    return;
  }

  const command = parseSlashCommand(value);
  if (command) {
    const shouldContinue = await handleCommand(command);
    if (shouldContinue && !controller && !exiting) printPrompt();
    return;
  }

  if (controller) {
    console.log(color.warning("当前已有任务运行，请先输入 /cancel。"));
    printPrompt();
    return;
  }

  if (planMode) {
    await runPlanningTurn(value);
    return;
  }
  if (activeGoal?.status === "active") {
    await runGoalTurn(value);
    return;
  }
  await runTask(value);
}

async function runTask(
  value: string,
  taskOptions: TaskExecutionOptions = {},
): Promise<TaskRunResult> {
  const startedAt = Date.now();
  let response = "";
  let summary = "";
  let completed = false;
  let verified = false;
  let validationCommands: string[] = [];
  let totalTokens = 0;
  const taskController = new AbortController();
  const recorder = new SessionRecorder(
    taskOptions.recordedTask ?? value,
    agent.modelName,
    agent.mode,
    [...agent.getSecrets(), process.env.CODEMUSE_API_KEY],
  );
  const resume = pendingResume;
  pendingResume = null;
  controller = taskController;
  activeSessionRecorder = recorder;
  console.log(`\n${color.bold("You")}\n${sanitizeTerminalText(taskOptions.displayTask ?? value)}\n`);

  try {
    const projectMemories = taskOptions.contextMode === "none"
      ? []
      : await memoryStore.retrieve(value).catch(() => []);
    for await (const event of agent.run(value, {
      signal: taskController.signal,
      workspace,
      requestApproval,
      ...(resume ? { resume } : {}),
      ...(taskOptions.toolPolicy
        ? { toolPolicy: taskOptions.toolPolicy }
        : {}),
      ...(taskOptions.contextMode
        ? { contextMode: taskOptions.contextMode }
        : {}),
      ...(taskOptions.executionScope
        ? { executionScope: taskOptions.executionScope }
        : {}),
      ...(projectMemories.length ? { projectMemories } : {}),
    })) {
      recorder.recordEvent(event);
      if (event.type === "message-delta") response += event.content;
      if (event.type === "model-usage") totalTokens += event.usage.totalTokens;
      if (event.type === "complete") {
        completed = true;
        summary = event.summary ?? "任务完成";
        verified = event.verified ?? false;
        validationCommands = event.validationCommands ?? [];
      }
      if (event.type === "error") summary = event.message;
      if (exiting) continue;
      if (
        taskController.signal.aborted &&
        event.type !== "notice" &&
        event.type !== "error"
      ) {
        continue;
      }
      handleAgentEvent(event);
    }
  } catch (error) {
    recorder.recordUnhandledError(error);
    if (!taskController.signal.aborted) {
      const message = error instanceof Error ? error.message : String(error);
      summary = message;
      console.log(color.error(`错误：${sanitizeTerminalText(message)}`));
    }
  } finally {
    settleApproval("denied");
    if (controller === taskController) controller = null;
    if (activeSessionRecorder === recorder) activeSessionRecorder = null;
    await saveSession(recorder, taskController.signal.aborted);
    if (!exiting && !taskOptions.deferPrompt) printPrompt();
  }
  return {
    response,
    summary: summary || (taskController.signal.aborted ? "任务已取消" : "任务未完成"),
    completed,
    verified,
    validationCommands,
    totalTokens,
    runtimeMs: Date.now() - startedAt,
  };
}

async function handleCommand(command: SlashCommand): Promise<boolean> {
  switch (command.name) {
    case "help":
      console.log(`\n${HELP_TEXT}\n`);
      return true;
    case "clear":
      if (controller) {
        console.log(color.warning("任务运行时不能清空状态，请先输入 /cancel。"));
        return false;
      }
      agent.clearState();
      pendingResume = null;
      console.clear();
      printHeader(workspace, agent.modelName, agent.mode);
      return true;
    case "cancel":
      if (controller) {
        settleApproval("denied");
        controller.abort(new Error("用户取消任务"));
        return false;
      }
      console.log(color.muted("当前没有正在运行的任务。"));
      return true;
    case "model":
      return runModelCommand(command);
    case "review":
      return runReviewCommand(command);
    case "paste":
      return startPaste();
    case "usage":
      printUsage(agent.getUsage());
      return true;
    case "workspace":
      console.log(`当前工作区：${sanitizeTerminalText(workspace)}`);
      return true;
    case "plan":
      return runPlanCommand(command);
    case "goal":
      return runGoalCommand(command);
    case "memory":
      return runMemoryCommand(command);
    case "approval":
      return runApprovalCommand(command);
    case "doctor":
      return runDoctor(command);
    case "context":
      printContextSummary(agent.getState().context);
      return true;
    case "scan":
      return runScan();
    case "undo":
      return runUndo();
    case "history":
      return runHistory();
    case "resume":
      return runResume(command.id);
    case "exit":
      shutdown();
      return false;
    case "unknown":
      console.log(color.warning(`未知命令：/${sanitizeTerminalText(command.value)}`));
      return true;
  }
}

async function runPlanCommand(
  command: Extract<SlashCommand, { name: "plan" }>,
): Promise<boolean> {
  if (controller) {
    console.log(color.warning("当前已有任务运行，请先输入 /cancel。"));
    return false;
  }
  try {
    switch (command.action) {
      case "status":
        activePlan = await planStore.load();
        if (activePlan) printPlanArtifact(activePlan);
        else printPlan(agent.getState().plan);
        console.log(color.muted(`  Plan Mode：${planMode ? "开启" : "关闭"}`));
        return true;
      case "on":
        planMode = true;
        activePlan = await planStore.load();
        if (
          activePlan &&
          !["draft", "ready", "stale"].includes(activePlan.status)
        ) {
          activePlan = null;
        }
        console.log(color.success("✓ 已进入 Plan Mode；接下来的自然语言只会进行只读探索和计划编制。"));
        if (activePlan && !["cancelled", "completed"].includes(activePlan.status)) {
          printPlanArtifact(activePlan);
        }
        return true;
      case "revise":
        if (!command.value) {
          console.log(color.warning("用法：/plan revise <修订要求>"));
          return true;
        }
        planMode = true;
        await runPlanningTurn(command.value);
        return false;
      case "approve":
        await approveAndExecutePlan();
        return false;
      case "off":
        planMode = false;
        if (activePlan && ["draft", "ready", "stale"].includes(activePlan.status)) {
          activePlan = await planStore.setStatus(activePlan, "cancelled");
        }
        console.log(color.muted("已退出 Plan Mode；未执行计划。"));
        return true;
    }
  } catch (error) {
    console.log(color.error(`Plan 操作失败：${sanitizeTerminalText(errorMessage(error))}`));
    return true;
  }
}

async function runPlanningTurn(requirement: string): Promise<void> {
  const current = activePlan &&
      ["draft", "ready", "stale"].includes(activePlan.status)
    ? activePlan
    : null;
  const task = current
    ? [
      `只读探索并修订现有计划。原目标：${current.objective}`,
      `本轮修订要求：${requirement}`,
      "不得修改文件或执行任何命令；请给出更新后的实施步骤、影响文件、验证和风险。",
    ].join("\n")
    : [
      `为以下任务制定可执行计划：${requirement}`,
      "只允许只读探索；请给出实施步骤、影响文件、验证、风险和假设。",
    ].join("\n");
  const result = await runTask(task, {
    toolPolicy: "read-only",
    contextMode: "workspace",
    recordedTask: current
      ? `修订计划：${current.objective}`
      : `制定计划：${requirement}`,
    displayTask: current ? `修订计划：${requirement}` : requirement,
    deferPrompt: true,
  });
  if (!result.completed) {
    console.log(color.warning("计划生成未完成，现有计划保持不变。"));
    if (!exiting) printPrompt();
    return;
  }
  const state = agent.getState();
  activePlan = current
    ? await planStore.revise(
      current,
      requirement,
      state.project,
      state.context,
      result.response,
    )
    : await planStore.create(
      requirement,
      state.project,
      state.context,
      result.response,
    );
  printPlanArtifact(activePlan);
  console.log(color.muted("计划已保存。可继续输入要求修订，或使用 /plan approve 批准执行。"));
  if (!exiting) printPrompt();
}

async function approveAndExecutePlan(): Promise<void> {
  activePlan = await planStore.load();
  if (!activePlan) {
    console.log(color.warning("当前没有可批准的结构化计划。"));
    printPrompt();
    return;
  }
  if (!["ready", "stale"].includes(activePlan.status)) {
    console.log(color.warning(`计划状态 ${activePlan.status} 不能批准。`));
    printPrompt();
    return;
  }
  if (!await planStore.verifyFresh(activePlan)) {
    activePlan = await planStore.setStatus(activePlan, "stale");
    console.log(color.warning("工作区在计划生成后发生变化，计划已标记为 stale；请重新修订。"));
    printPrompt();
    return;
  }
  activePlan = await planStore.setStatus(activePlan, "approved");
  activePlan = await planStore.setStatus(activePlan, "executing");
  executingPlan = activePlan;
  planMode = false;
  const result = await runTask(formatPlanExecutionTask(activePlan), {
    toolPolicy: "full",
    contextMode: "workspace",
    executionScope: activePlan.scope,
    recordedTask: `执行计划 ${activePlan.id.slice(0, 8)}：${activePlan.objective}`,
    displayTask: `执行已批准计划：${activePlan.objective}`,
    deferPrompt: true,
  });
  executingPlan = null;
  const steps = activePlan.steps.map((step) => ({
    ...step,
    status: result.completed
      ? "completed" as const
      : "failed" as const,
  }));
  activePlan = await planStore.save({
    ...activePlan,
    steps,
    status: result.completed && result.verified ? "completed" : "ready",
    updatedAt: new Date().toISOString(),
  });
  printPlanArtifact(activePlan);
  if (result.completed && !result.verified) {
    console.log(color.warning("计划执行产生了未验证结果，计划已返回 ready，需修订或补充验证后再次批准。"));
  }
  if (!exiting) printPrompt();
}

async function runGoalCommand(
  command: Extract<SlashCommand, { name: "goal" }>,
): Promise<boolean> {
  if (controller) {
    console.log(color.warning("当前已有任务运行，请先输入 /cancel。"));
    return false;
  }
  try {
    switch (command.action) {
      case "create":
        if (!command.value) {
          console.log(color.warning("用法：/goal create <目标>"));
          return true;
        }
        activeGoal = await goalStore.create(command.value);
        printGoal(activeGoal);
        console.log(color.muted("Goal 已保存；输入自然语言子任务推进，或使用 /goal resume 直接开始。"));
        return true;
      case "status":
        activeGoal = await goalStore.active();
        printGoal(activeGoal);
        return true;
      case "history":
        printGoalHistory(await goalStore.history());
        return true;
      case "pause":
        if (!activeGoal) throw new Error("当前没有活动目标");
        activeGoal = await goalStore.setStatus(activeGoal, "paused");
        printGoal(activeGoal);
        return true;
      case "resume":
        activeGoal = await goalStore.active();
        if (!activeGoal) throw new Error("当前没有可恢复目标");
        if (
          activeGoal.status === "paused" ||
          activeGoal.status === "blocked"
        ) {
          activeGoal = await goalStore.setStatus(activeGoal, "active");
        }
        if (activeGoal.status !== "active") {
          throw new Error(`目标状态 ${activeGoal.status} 不能恢复`);
        }
        await runGoalTurn(activeGoal.objective);
        return false;
      case "complete":
        if (!activeGoal) throw new Error("当前没有活动目标");
        if (!activeGoal.evidence.some((item) => /验证通过|验证：/.test(item))) {
          throw new Error("目标缺少成功验证证据，不能标记为完成");
        }
        activeGoal = await goalStore.setStatus(activeGoal, "completed");
        printGoal(activeGoal);
        return true;
      case "cancel":
        if (!activeGoal) throw new Error("当前没有活动目标");
        activeGoal = await goalStore.setStatus(activeGoal, "cancelled");
        printGoal(activeGoal);
        activeGoal = null;
        return true;
    }
  } catch (error) {
    console.log(color.error(`Goal 操作失败：${sanitizeTerminalText(errorMessage(error))}`));
    return true;
  }
}

async function runGoalTurn(instruction: string): Promise<void> {
  if (!activeGoal || activeGoal.status !== "active") {
    console.log(color.warning("当前没有 active Goal。"));
    printPrompt();
    return;
  }
  const goal = activeGoal;
  const task = [
    `长期目标：${goal.objective}`,
    "成功标准：",
    ...goal.successCriteria.map((criterion) => `- ${criterion}`),
    `本轮任务：${instruction}`,
    "只推进尚未完成的工作；必须基于真实工具证据更新结果。",
  ].join("\n");
  const result = await runTask(task, {
    toolPolicy: "full",
    contextMode: "workspace",
    recordedTask: `Goal ${goal.id.slice(0, 8)}：${instruction}`,
    displayTask: instruction,
    deferPrompt: true,
  });
  const implementationGoal = /修复|实现|修改|新增|删除|重构|代码|build|implement|fix/i
    .test(goal.objective);
  activeGoal = await goalStore.recordRun(goal, {
    summary: result.summary,
    totalTokens: result.totalTokens,
    runtimeMs: result.runtimeMs,
    completed: result.completed,
    verified: result.verified &&
      (!implementationGoal || result.validationCommands.length > 0),
    validationCommands: result.validationCommands,
  });
  if (exiting && activeGoal.status === "active") {
    activeGoal = await goalStore.setStatus(activeGoal, "paused");
  }
  printGoal(activeGoal);
  if (activeGoal.status === "completed") {
    console.log(color.success("✓ Goal 已满足成功和验证条件。"));
    activeGoal = null;
  } else if (activeGoal.status === "blocked") {
    console.log(color.warning("Goal 已因预算耗尽或重复失败进入 blocked。"));
  }
  if (!exiting) printPrompt();
}

async function runMemoryCommand(
  command: Extract<SlashCommand, { name: "memory" }>,
): Promise<boolean> {
  try {
    switch (command.action) {
      case "list":
        printMemories(await memoryStore.list());
        return true;
      case "show":
        if (!command.value) {
          console.log(color.warning("用法：/memory show <ID>"));
          return true;
        }
        printMemory(await memoryStore.get(command.value));
        return true;
      case "add":
        if (!command.value) {
          console.log(color.warning("用法：/memory add <内容>"));
          return true;
        }
        printMemory(await memoryStore.add(command.value));
        return true;
      case "forget":
        if (!command.value) {
          console.log(color.warning("用法：/memory forget <ID>"));
          return true;
        }
        console.log(
          await memoryStore.forget(command.value)
            ? color.success("✓ 已遗忘指定项目记忆。")
            : color.warning("没有找到指定项目记忆。"),
        );
        return true;
      case "clear":
        await memoryStore.clear();
        console.log(color.success("✓ 已清空当前工作区项目记忆。"));
        return true;
    }
  } catch (error) {
    console.log(color.error(`Memory 操作失败：${sanitizeTerminalText(errorMessage(error))}`));
    return true;
  }
}

async function runApprovalCommand(
  command: Extract<SlashCommand, { name: "approval" }>,
): Promise<boolean> {
  if (!command.mode) {
    console.log(`当前授权模式：${settings.approvalMode}`);
    return true;
  }
  settings = { ...settings, approvalMode: command.mode };
  await settingsStore.save(settings);
  console.log(color.success(`✓ 授权模式已设置为 ${command.mode}`));
  if (command.mode === "plan-scoped") {
    console.log(color.muted("仅已批准计划范围内的普通写入和验证命令可自动授权；删除与重命名仍逐项确认。"));
  }
  return true;
}

async function runDoctor(
  command: Extract<SlashCommand, { name: "doctor" }>,
): Promise<boolean> {
  const checks = await runDoctorChecks(workspace);
  printDoctor(checks);
  await diagnosticLogger.record(
    checks.some((check) => check.status === "fail") ? "error" : "info",
    "doctor",
    checks.map((check) => `${check.name}:${check.status}:${check.message}`).join(" | "),
  );
  if (command.action === "export") {
    console.log(color.muted(
      `已脱敏诊断记录：${sanitizeTerminalText(diagnosticLogger.path)}`,
    ));
  }
  return true;
}

async function runReviewCommand(
  command: Extract<SlashCommand, { name: "review" }>,
): Promise<boolean> {
  if (controller) {
    console.log(color.warning("当前已有任务运行，请先输入 /cancel。"));
    return false;
  }
  try {
    const task = buildReviewTask(command.mode, command.target);
    const label = command.target
      ? "代码审查：" + command.target
      : "代码审查：当前工作区";
    await runTask(task, {
      toolPolicy: command.mode === "fix" ? "full" : "read-only",
      contextMode: "workspace",
      recordedTask: label + (command.mode === "fix" ? "（允许确认后修复）" : "（只读）"),
      displayTask: label,
    });
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(color.error("无法开始代码审查：" + sanitizeTerminalText(message)));
    return true;
  }
}

function startPaste(): boolean {
  if (controller) {
    console.log(color.warning("当前已有任务运行，请先输入 /cancel。"));
    return false;
  }
  pasteBuffer = new PasteBuffer();
  console.log(color.bold("\n粘贴代码片段"));
  console.log(color.muted("输入 .end 开始只读审查，输入 /cancel 取消；不会扫描本地项目。"));
  printPastePrompt();
  return false;
}

async function handlePasteLine(line: string): Promise<void> {
  const control = line.trim().toLowerCase();
  if (control === "/exit") {
    pasteBuffer = null;
    shutdown();
    return;
  }
  if (control === "/cancel") {
    pasteBuffer = null;
    console.log(color.muted("已取消粘贴代码审查。"));
    printPrompt();
    return;
  }
  if (control === ".end") {
    const buffer = pasteBuffer;
    pasteBuffer = null;
    if (!buffer) return;
    try {
      const snippet = buffer.finish();
      await runTask(buildPastedReviewTask(snippet), {
        toolPolicy: "none",
        contextMode: "none",
        recordedTask: "审查用户粘贴的代码片段（内容未保存）",
        displayTask: "审查已粘贴的代码片段，共 " + buffer.lineCount + " 行",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(color.error("粘贴代码审查失败：" + sanitizeTerminalText(message)));
      printPrompt();
    }
    return;
  }

  const activeBuffer = pasteBuffer;
  if (!activeBuffer) return;
  try {
    activeBuffer.add(line);
    printPastePrompt();
  } catch (error) {
    pasteBuffer = null;
    const message = error instanceof Error ? error.message : String(error);
    console.log(color.error("粘贴失败：" + sanitizeTerminalText(message)));
    printPrompt();
  }
}

function printPastePrompt(): void {
  process.stdout.write(color.brand("paste> "));
}

async function runModelCommand(
  command: Extract<SlashCommand, { name: "model" }>,
): Promise<boolean> {
  if (controller) {
    console.log(color.warning("当前已有任务运行，请先输入 /cancel。"));
    return false;
  }

  try {
    switch (command.action) {
      case "show":
      case "list":
        printModelProfiles(agent.listProfiles(), agent.configPath);
        return true;
      case "use": {
        if (!command.value) {
          console.log(color.warning("用法：/model use <NAME>"));
          return true;
        }
        const result = agent.switchProfile(command.value);
        console.log(
          color.success(
            `✓ ${sanitizeTerminalText(result.message)}：${sanitizeTerminalText(result.modelName)} (${result.mode})`,
          ),
        );
        return true;
      }
      case "test":
        return runModelTest(command.value);
      case "init": {
        const result = await agent.initializeConfig();
        console.log(
          result.created
            ? color.success(`✓ 已创建本机模型配置：${sanitizeTerminalText(result.path)}`)
            : color.muted(`模型配置已存在：${sanitizeTerminalText(result.path)}`),
        );
        printModelProfiles(agent.listProfiles(), agent.configPath);
        return true;
      }
      case "reload": {
        const result = await agent.reloadProfiles();
        console.log(color.success(`✓ ${sanitizeTerminalText(result.message)}`));
        printModelProfiles(agent.listProfiles(), agent.configPath);
        return true;
      }
      case "unknown":
        console.log(
          color.warning(
            `未知 /model 操作：${sanitizeTerminalText(command.value || "")}`,
          ),
        );
        return true;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(color.error(`模型操作失败：${sanitizeTerminalText(message)}`));
    return true;
  }
}

async function runModelTest(profile?: string): Promise<boolean> {
  const testController = new AbortController();
  controller = testController;
  console.log(color.brand("\n● 测试模型 API 连接"));
  try {
    const result = await agent.testConnection(profile, testController.signal);
    if (!exiting && !testController.signal.aborted) {
      printConnectionResult(result);
    }
  } catch (error) {
    if (!testController.signal.aborted) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(color.error(`模型连接测试失败：${sanitizeTerminalText(message)}`));
    }
  } finally {
    if (controller === testController) controller = null;
  }
  return true;
}
async function runScan(): Promise<boolean> {
  if (controller) {
    console.log(color.warning("当前已有任务运行，请先输入 /cancel。"));
    return false;
  }
  const scanController = new AbortController();
  controller = scanController;
  console.log(color.brand("\n● 重新扫描当前项目"));
  try {
    const project = await agent.scan({
      signal: scanController.signal,
      workspace,
    });
    if (!exiting) printProjectScan(project);
  } catch (error) {
    if (!scanController.signal.aborted) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(color.error(`扫描失败：${sanitizeTerminalText(message)}`));
    }
  } finally {
    if (controller === scanController) controller = null;
  }
  return true;
}

async function runUndo(): Promise<boolean> {
  if (controller) {
    console.log(color.warning("当前已有任务运行，请先输入 /cancel。"));
    return false;
  }
  const undoController = new AbortController();
  controller = undoController;
  console.log(color.brand("\n● 准备撤销最近一次任务修改"));
  try {
    const result = await agent.undo({
      signal: undoController.signal,
      workspace,
      requestApproval,
    });
    console.log(
      result.undone
        ? color.success(`✓ ${sanitizeTerminalText(result.summary)}：${sanitizeTerminalText(result.restoredFiles.join("、"))}`)
        : color.muted(sanitizeTerminalText(result.summary)),
    );
  } catch (error) {
    if (!undoController.signal.aborted) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(color.error(`撤销失败：${sanitizeTerminalText(message)}`));
    }
  } finally {
    settleApproval("denied");
    if (controller === undoController) controller = null;
  }
  return true;
}

async function runHistory(): Promise<boolean> {
  if (controller) {
    console.log(color.warning("当前已有任务运行，请先输入 /cancel。"));
    return false;
  }
  try {
    const sessions = await sessionStore.list(10);
    if (!exiting) printSessionHistory(sessions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(color.error(`读取会话历史失败：${sanitizeTerminalText(message)}`));
  }
  return true;
}

async function runResume(id?: string): Promise<boolean> {
  if (controller) {
    console.log(color.warning("当前已有任务运行，请先输入 /cancel。"));
    return false;
  }

  const resumeController = new AbortController();
  controller = resumeController;
  try {
    const session = await sessionStore.resume(id, resumeController.signal);
    agent.restoreState(session.state);
    pendingResume = createAgentResumeContext(session);
    if (!exiting) printSessionRestored(session);
  } catch (error) {
    if (!resumeController.signal.aborted) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(color.error(`恢复会话失败：${sanitizeTerminalText(message)}`));
    }
  } finally {
    if (controller === resumeController) controller = null;
  }
  return true;
}

async function saveSession(
  recorder: SessionRecorder,
  wasAborted: boolean,
): Promise<void> {
  try {
    const saved = await sessionStore.save(
      recorder.toDraft(agent.getState(), wasAborted),
      new AbortController().signal,
    );
    if (!exiting) {
      console.log(color.muted(`会话已保存：${saved.id.slice(0, 8)}`));
    }
  } catch (error) {
    if (!exiting) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(color.warning(`会话保存失败：${sanitizeTerminalText(message)}`));
    }
  }
}
const requestApproval: ApprovalHandler = async (request, signal) => {
  if (exiting || signal.aborted) return "denied";
  if (pendingApproval) throw new Error("已有操作正在等待确认");
  if (canAutoApprovePlanRequest(request)) {
    activeSessionRecorder?.recordApproval(request, "approved");
    console.log(color.success(
      `  ✓ 已按批准计划自动授权：${sanitizeTerminalText(request.title)}`,
    ));
    return "approved";
  }

  printApprovalRequest(request);
  process.stdout.write(color.warning("允许执行此操作？输入 y 确认，其他输入拒绝 [y/N]: "));

  return new Promise<ApprovalDecision>((resolveDecision) => {
    const onAbort = (): void => settleApproval("denied");
    signal.addEventListener("abort", onAbort, { once: true });
    const recorder = activeSessionRecorder;
    pendingApproval = {
      id: request.id,
      resolve: (decision) => {
        signal.removeEventListener("abort", onAbort);
        recorder?.recordApproval(request, decision);
        resolveDecision(decision);
      },
    };
  });
};

function canAutoApprovePlanRequest(
  request: Parameters<ApprovalHandler>[0],
): boolean {
  if (
    settings.approvalMode !== "plan-scoped" ||
    !executingPlan ||
    executingPlan.status !== "executing"
  ) {
    return false;
  }
  if (/删除|重命名/i.test(request.title)) return false;
  if (request.kind === "write") {
    return request.paths.length > 0 &&
      request.paths.every((path) =>
        executingPlan!.scope.some((scopePath) =>
          path === scopePath ||
          scopePath.endsWith("/**") &&
            path.startsWith(scopePath.slice(0, -2))
        )
      );
  }
  if (request.kind === "execute") {
    return executingPlan.validation.some((command) =>
      request.diff.includes(command)
    );
  }
  return false;
}

function handleApprovalAnswer(value: string): void {
  const normalized = value.toLowerCase();
  if (normalized === "y" || normalized === "yes") {
    console.log(color.success("已授权，继续执行。"));
    settleApproval("approved");
    return;
  }

  if (normalized === "/exit") {
    settleApproval("denied");
    shutdown();
    return;
  }

  if (normalized === "/cancel") {
    settleApproval("denied");
    controller?.abort(new Error("用户取消任务"));
    return;
  }

  console.log(color.warning("已拒绝，文件不会被修改。"));
  settleApproval("denied");
}

function settleApproval(decision: ApprovalDecision): void {
  const pending = pendingApproval;
  if (!pending) return;
  pendingApproval = null;
  pending.resolve(decision);
}

function shutdown(): void {
  if (exiting) return;
  exiting = true;
  if (!controller && activeGoal?.status === "active") {
    void goalStore.setStatus(activeGoal, "paused").catch(() => undefined);
  }
  pasteBuffer = null;
  settleApproval("denied");
  controller?.abort(new Error("程序退出"));
  console.log(color.muted("\n已退出 CodeMuse。"));
  readline.close();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
}
