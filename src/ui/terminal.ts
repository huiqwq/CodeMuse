import type { AgentEvent } from "../types.ts";
import { color } from "./colors.ts";

export function printHeader(workspace: string, model: string, mode: string): void {
  const width = Math.min(process.stdout.columns || 72, 88);
  const rule = "─".repeat(Math.max(36, width));

  console.log();
  console.log(color.bold(color.brand("  CodeMuse  v0.1.0")));
  console.log(`  ${color.muted("Workspace")}  ${workspace}`);
  console.log(`  ${color.muted("Model")}      ${model}`);
  console.log(`  ${color.muted("Mode")}       ${mode}`);
  console.log(color.muted(rule));
  console.log(color.muted("  输入任务开始对话，输入 /help 查看命令。"));
  console.log();
}

export function printPrompt(): void {
  process.stdout.write(color.brand("codemuse> "));
}

export function handleAgentEvent(event: AgentEvent): void {
  switch (event.type) {
    case "message-start":
      process.stdout.write(`\n${color.bold("CodeMuse")}\n`);
      break;
    case "message-delta":
      process.stdout.write(event.content);
      break;
    case "message-complete":
      process.stdout.write("\n");
      break;
    case "step-start":
      console.log(color.brand(`● ${event.title}`));
      break;
    case "step-complete":
      console.log(color.success(`✓ ${event.result || event.id}`));
      break;
    case "step-failed":
      console.log(color.error(`✗ ${event.error}`));
      break;
    case "notice":
      console.log(color.warning(event.message));
      break;
    case "error":
      console.log(color.error(`错误：${event.message}`));
      break;
    case "complete":
      if (event.summary) console.log(color.muted(event.summary));
      console.log();
      break;
  }
}
