import type {
  AgentEvent,
  ApprovalRequest,
  ContextSummary,
  ProjectScan,
  TaskPlan,
} from "../types.ts";
import { color } from "./colors.ts";

export function printHeader(workspace: string, model: string, mode: string): void {
  const width = Math.min(process.stdout.columns || 72, 88);
  const rule = "─".repeat(Math.max(36, width));

  console.log();
  console.log(color.bold(color.brand("  CodeMuse  v0.4.0")));
  console.log(`  ${color.muted("Workspace")}  ${sanitizeTerminalText(workspace)}`);
  console.log(`  ${color.muted("Model")}      ${sanitizeTerminalText(model)}`);
  console.log(`  ${color.muted("Mode")}       ${sanitizeTerminalText(mode)}`);
  console.log(color.muted(rule));
  console.log(color.muted("  输入代码分析或修改任务，输入 /help 查看命令。"));
  console.log();
}

export function printPrompt(): void {
  process.stdout.write(color.brand("codemuse> "));
}

export function printPlan(plan: TaskPlan | null): void {
  if (!plan) {
    console.log(color.muted("当前还没有任务计划，请先输入一个任务。"));
    return;
  }

  console.log(color.bold(`\n任务计划：${sanitizeTerminalText(plan.task)}`));
  for (const step of plan.steps) {
    console.log(`  ${statusSymbol(step.status)} ${sanitizeTerminalText(step.title)}`);
  }
  console.log();
}

export function printContextSummary(context: ContextSummary | null): void {
  if (!context) {
    console.log(color.muted("当前还没有上下文记录，请先输入一个任务。"));
    return;
  }

  console.log(color.bold("\n上下文选择"));
  console.log(
    `  Token  ${context.estimatedTokens}/${context.budgetTokens}` +
      (context.truncated ? "（已筛选或截断）" : ""),
  );
  for (const file of context.files) {
    console.log(
      `  - ${sanitizeTerminalText(file.path)}  约 ${file.estimatedTokens} Tokens` +
        (file.truncated ? "（片段）" : ""),
    );
  }
  if (context.omittedFiles > 0) {
    console.log(color.muted(`  另有 ${context.omittedFiles} 个候选文件未加入上下文`));
  }
  console.log();
}

export function printProjectScan(project: ProjectScan): void {
  console.log(color.bold(`\n项目扫描：${sanitizeTerminalText(project.projectName)}`));
  console.log(`  类型      ${sanitizeTerminalText(project.projectTypes.join("、"))}`);
  console.log(`  语言      ${sanitizeTerminalText(project.languages.join("、") || "未识别")}`);
  console.log(`  框架      ${sanitizeTerminalText(project.frameworks.join("、") || "未识别")}`);
  console.log(`  包管理器  ${sanitizeTerminalText(project.packageManager ?? "未识别")}`);
  console.log(
    `  文件      ${project.fileCount}${project.truncated ? "（扫描已截断）" : ""}`,
  );
  console.log(`  关键文件  ${sanitizeTerminalText(project.keyFiles.join("、") || "未识别")}`);
  console.log();
}

export function printApprovalRequest(request: ApprovalRequest): void {
  console.log(color.warning(`\n需要确认：${sanitizeTerminalText(request.title)}`));
  console.log(color.muted(`  ${sanitizeTerminalText(request.summary)}`));
  console.log();
  for (const rawLine of request.diff.split("\n")) {
    const line = sanitizeTerminalText(rawLine);
    if (line.startsWith("+") && !line.startsWith("+++")) {
      console.log(color.success(line));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      console.log(color.error(line));
    } else {
      console.log(color.muted(line));
    }
  }
  console.log();
}

export function handleAgentEvent(event: AgentEvent): void {
  switch (event.type) {
    case "message-start":
      process.stdout.write(`\n${color.bold("CodeMuse")}\n`);
      break;
    case "message-delta":
      process.stdout.write(sanitizeTerminalText(event.content));
      break;
    case "message-complete":
      process.stdout.write("\n");
      break;
    case "step-start":
      console.log(color.brand(`● ${sanitizeTerminalText(event.title)}`));
      break;
    case "step-complete":
      console.log(color.success(`✓ ${sanitizeTerminalText(event.result || event.id)}`));
      break;
    case "step-failed":
      console.log(color.error(`× ${sanitizeTerminalText(event.error)}`));
      break;
    case "project-scanned":
      console.log(
        color.muted(
          `  项目：${sanitizeTerminalText(event.project.projectName)} · ${sanitizeTerminalText(event.project.projectTypes.join("、"))} · ${event.project.fileCount} 个文件`,
        ),
      );
      break;
    case "plan-updated":
      printPlan(event.plan);
      break;
    case "context-selected":
      printContextSummary(event.context);
      break;
    case "tool-start":
      console.log(color.brand(`  → ${sanitizeTerminalText(event.name)}  ${sanitizeTerminalText(event.summary)}`));
      break;
    case "tool-complete":
      console.log(color.success(`  ✓ ${sanitizeTerminalText(event.name)}  ${sanitizeTerminalText(event.summary)}`));
      break;
    case "tool-failed":
      console.log(color.error(`  × ${sanitizeTerminalText(event.name)}  ${sanitizeTerminalText(event.error)}`));
      break;
    case "notice":
      console.log(color.warning(sanitizeTerminalText(event.message)));
      break;
    case "error":
      console.log(color.error(`错误：${sanitizeTerminalText(event.message)}`));
      break;
    case "complete":
      if (event.summary) console.log(color.muted(sanitizeTerminalText(event.summary)));
      console.log();
      break;
  }
}

function statusSymbol(status: TaskPlan["steps"][number]["status"]): string {
  switch (status) {
    case "pending":
      return color.muted("○");
    case "running":
      return color.brand("●");
    case "completed":
      return color.success("✓");
    case "failed":
      return color.error("×");
    case "cancelled":
      return color.warning("-");
  }
}

export function sanitizeTerminalText(value: string): string {
  return value.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g,
    (character) => `<0x${character.charCodeAt(0).toString(16).padStart(2, "0")}>`,
  );
}
