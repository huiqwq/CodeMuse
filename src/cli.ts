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
  printHeader,
  printModelProfiles,
  printPlan,
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
  AgentResumeContext,
  AgentRunOptions,
  ApprovalDecision,
  ApprovalHandler,
} from "./types.ts";

type PendingApproval = {
  id: string;
  resolve: (decision: ApprovalDecision) => void;
};

type TaskExecutionOptions = Pick<
  AgentRunOptions,
  "toolPolicy" | "contextMode"
> & {
  recordedTask?: string;
  displayTask?: string;
};

const args = process.argv.slice(2);
if (args[0]?.toLowerCase() === "auth") {
  process.exitCode = await runAuthCommand(args.slice(1));
} else {
const workspace = resolve(args.find((arg) => !arg.startsWith("-")) || ".");
const agent = await createAgent();
const sessionStore = new SessionStore(workspace);
const readline = createInterface({ input, output, terminal: true });
let controller: AbortController | null = null;
let activeSessionRecorder: SessionRecorder | null = null;
let pendingResume: AgentResumeContext | null = null;
let pendingApproval: PendingApproval | null = null;
let exiting = false;
let pasteBuffer: PasteBuffer | null = null;

printHeader(workspace, agent.modelName, agent.mode);
printPrompt();

readline.on("SIGINT", () => {
  if (controller) {
    settleApproval("denied");
    controller.abort(new Error("用户取消任务"));
    return;
  }
  shutdown();
});

readline.on("line", (line) => void processLine(line));
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

  await runTask(value);
}

async function runTask(
  value: string,
  taskOptions: TaskExecutionOptions = {},
): Promise<void> {
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
    })) {
      recorder.recordEvent(event);
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
      console.log(color.error(`错误：${sanitizeTerminalText(message)}`));
    }
  } finally {
    settleApproval("denied");
    if (controller === taskController) controller = null;
    if (activeSessionRecorder === recorder) activeSessionRecorder = null;
    await saveSession(recorder, taskController.signal.aborted);
    if (!exiting) printPrompt();
  }
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
      printPlan(agent.getState().plan);
      return true;
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
  pasteBuffer = null;
  settleApproval("denied");
  controller?.abort(new Error("程序退出"));
  console.log(color.muted("\n已退出 CodeMuse。"));
  readline.close();
}
}
