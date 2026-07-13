#!/usr/bin/env node

import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { createAgent } from "./agent/create-agent.ts";
import {
  HELP_TEXT,
  parseSlashCommand,
  type SlashCommand,
} from "./commands/slash-command.ts";
import { handleAgentEvent, printHeader, printPrompt } from "./ui/terminal.ts";
import { color } from "./ui/colors.ts";

const args = process.argv.slice(2);
const workspace = resolve(args.find((arg) => !arg.startsWith("-")) || ".");
const agent = createAgent();
const readline = createInterface({ input, output, terminal: true });
let controller: AbortController | null = null;
let exiting = false;

printHeader(workspace, agent.modelName, agent.mode);
printPrompt();

readline.on("SIGINT", () => {
  if (controller) {
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
  const value = line.trim();

  if (!value) {
    printPrompt();
    return;
  }

  const command = parseSlashCommand(value);
  if (command) {
    const shouldContinue = handleCommand(command);
    if (shouldContinue) printPrompt();
    return;
  }

  if (controller) {
    console.log(color.warning("当前已有任务运行，请先输入 /cancel。"));
    printPrompt();
    return;
  }

  controller = new AbortController();
  console.log(`\n${color.bold("You")}\n${value}\n`);

  try {
    for await (const event of agent.run(value, {
      signal: controller.signal,
      workspace,
    })) {
      handleAgentEvent(event);
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(color.error(`错误：${message}`));
    }
  } finally {
    controller = null;
    if (!exiting) printPrompt();
  }
}

function handleCommand(command: SlashCommand): boolean {
  switch (command.name) {
    case "help":
      console.log(`\n${HELP_TEXT}\n`);
      return true;
    case "clear":
      console.clear();
      printHeader(workspace, agent.modelName, agent.mode);
      return true;
    case "cancel":
      if (controller) {
        controller.abort(new Error("用户取消任务"));
        return false;
      }
      console.log(color.muted("当前没有正在运行的任务。"));
      return true;
    case "model":
      console.log(`当前模型：${agent.modelName} (${agent.mode})`);
      return true;
    case "workspace":
      console.log(`当前工作区：${workspace}`);
      return true;
    case "exit":
      shutdown();
      return false;
    case "unknown":
      console.log(color.warning(`未知命令：/${command.value}`));
      return true;
  }
}

function shutdown(): void {
  if (exiting) return;
  exiting = true;
  controller?.abort(new Error("程序退出"));
  console.log(color.muted("\n已退出 CodeMuse。"));
  readline.close();
}
