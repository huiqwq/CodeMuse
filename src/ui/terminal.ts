import type {
  AgentEvent,
  ApprovalRequest,
  ContextSummary,
  ProjectScan,
  TaskPlan,
} from "../types.ts";
import { color } from "./colors.ts";
import type {
  SessionHistoryItem,
  StoredSession,
} from "../sessions/types.ts";
import type {
  ManagedConnectionResult,
  ModelProfileSummary,
  UsageSummary,
} from "../agent/managed-agent.ts";

export function printHeader(workspace: string, model: string, mode: string): void {
  const width = Math.min(process.stdout.columns || 72, 88);
  const rule = "─".repeat(Math.max(36, width));

  console.log();
  console.log(color.bold(color.brand("  CodeMuse  v0.10.0")));
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
    case "model-usage":
      console.log(
        color.muted(
          `  Token  ${sanitizeTerminalText(event.model)}：输入 ${event.usage.promptTokens}，输出 ${event.usage.completionTokens}，合计 ${event.usage.totalTokens}`,
        ),
      );
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
    case "command-output":
      console.log(color.bold("\n命令输出"));
      console.log(sanitizeTerminalText(event.content));
      console.log();
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

export function printModelProfiles(
  profiles: ModelProfileSummary[],
  configPath: string,
): void {
  console.log(color.bold("\n模型 Profile"));
  console.log(`  配置文件  ${sanitizeTerminalText(configPath)}`);
  for (const profile of profiles) {
    const marker = profile.active ? color.success("*") : " ";
    const state = profile.source === "mock"
      ? color.muted("本地演示")
      : !profile.configured
      ? color.warning("缺少 " + profile.apiKeyEnv)
      : profile.credentialSource === "stored"
      ? color.success("已安全保存")
      : color.success("环境变量");
    console.log(
      `  ${marker} ${color.brand(sanitizeTerminalText(profile.name))}  ${sanitizeTerminalText(profile.provider)}/${sanitizeTerminalText(profile.model)}  ${state}`,
    );
  }
  console.log();
}

export function printConnectionResult(
  result: ManagedConnectionResult,
): void {
  const status = result.success ? color.success("成功") : color.error("失败");
  console.log(color.bold("\n模型连接测试"));
  console.log(`  Profile  ${sanitizeTerminalText(result.profile)}`);
  console.log(`  Model    ${sanitizeTerminalText(result.provider)}/${sanitizeTerminalText(result.model)}`);
  console.log(`  状态     ${status}`);
  console.log(`  耗时     ${result.latencyMs}ms`);
  console.log(`  尝试     ${result.attempts || "-"}`);
  console.log(`  结果     ${sanitizeTerminalText(result.message)}`);
  if (result.usage) {
    console.log(`  Token    ${result.usage.totalTokens}`);
  }
  console.log();
}

export function printUsage(usage: UsageSummary): void {
  console.log(color.bold("\nToken 用量（当前 CodeMuse 进程）"));
  if (!usage.byModel.length) {
    console.log(color.muted("  尚未收到模型 API 返回的 Token 统计。"));
    console.log();
    return;
  }
  for (const item of usage.byModel) {
    console.log(
      `  ${sanitizeTerminalText(item.model)}  输入 ${item.promptTokens}  输出 ${item.completionTokens}  合计 ${item.totalTokens}`,
    );
  }
  console.log(
    color.muted(
      `  总计  输入 ${usage.promptTokens}  输出 ${usage.completionTokens}  合计 ${usage.totalTokens}`,
    ),
  );
  console.log();
}
export function printSessionHistory(
  sessions: SessionHistoryItem[],
): void {
  console.log(color.bold("\n会话历史"));
  if (!sessions.length) {
    console.log(color.muted("  当前工作区还没有历史会话。"));
    console.log();
    return;
  }

  for (const session of sessions) {
    const id = session.id.slice(0, 8);
    const time = formatSessionTime(session.createdAt);
    console.log(
      `  ${color.brand(id)}  ${statusLabel(session.status)}  ${sanitizeTerminalText(time)}`,
    );
    console.log(`    ${sanitizeTerminalText(session.task)}`);
  }
  console.log(color.muted("  使用 /resume <ID> 恢复；省略 ID 时恢复最新会话。"));
  console.log();
}

export function printSessionRestored(session: StoredSession): void {
  console.log(color.success(
    `\n✓ 已恢复会话 ${session.id.slice(0, 8)}`,
  ));
  console.log(`  原任务  ${sanitizeTerminalText(session.task)}`);
  console.log(`  状态    ${statusLabel(session.status)}`);
  console.log(
    `  摘要    ${sanitizeTerminalText(session.summary ?? "无")}`,
  );
  console.log(color.muted("  旧计划和上下文已载入；下一条自然语言任务会继承此会话摘要。"));
  console.log();
}

function statusLabel(status: SessionHistoryItem["status"]): string {
  switch (status) {
    case "completed":
      return color.success("已完成");
    case "failed":
      return color.error("失败");
    case "cancelled":
      return color.warning("已取消");
    case "stopped":
      return color.warning("已停止");
  }
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("zh-CN", { hour12: false })
    : value;
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
