import { AgentStateStore } from "./agent-state.ts";
import {
  formatProjectSummary,
  selectTaskContext,
} from "../context/context-selector.ts";
import { scanProject } from "../context/project-scanner.ts";
import { openWorkspace } from "../context/workspace.ts";
import type {
  AgentEvent,
  AgentRunOptions,
  AgentRunner,
  AgentSessionState,
  ProjectScan,
} from "../types.ts";

export class MockAgent implements AgentRunner {
  readonly mode = "mock" as const;
  readonly modelName = "Mock（智能上下文演示）";
  private readonly state = new AgentStateStore();
  private readonly contextTokenBudget: number;

  constructor(contextTokenBudget = 6_000) {
    this.contextTokenBudget = contextTokenBudget;
  }

  async scan(options: AgentRunOptions): Promise<ProjectScan> {
    const workspace = await openWorkspace(options.workspace);
    const project = await scanProject(workspace, options.signal);
    this.state.clear();
    this.state.setProject(project);
    return project;
  }

  getState(): AgentSessionState {
    return this.state.snapshot();
  }

  clearState(): void {
    this.state.clear();
  }

  async *run(
    task: string,
    options: AgentRunOptions,
  ): AsyncGenerator<AgentEvent> {
    this.state.begin(task);

    try {
      const workspace = await openWorkspace(options.workspace);
      const initialPlan = this.state.snapshot().plan;
      if (initialPlan) yield { type: "plan-updated", plan: initialPlan };

      this.state.setStep("scan", "running");
      yield { type: "step-start", id: "scan", title: "扫描项目结构与技术栈" };
      const project = await scanProject(workspace, options.signal);
      this.state.setProject(project);
      this.state.setStep("scan", "completed");
      yield { type: "project-scanned", project };
      yield {
        type: "step-complete",
        id: "scan",
        result: `识别 ${project.fileCount} 个文件`,
      };

      this.state.setStep("context", "running");
      yield { type: "step-start", id: "context", title: "选择任务相关上下文" };
      const selection = await selectTaskContext(
        task,
        project,
        workspace,
        this.contextTokenBudget,
        options.signal,
      );
      this.state.setContext(selection.summary);
      this.state.setStep("context", "completed");
      yield { type: "context-selected", context: selection.summary };
      yield {
        type: "step-complete",
        id: "context",
        result: `选择 ${selection.summary.files.length} 个文件，约 ${selection.summary.estimatedTokens} Tokens`,
      };

      this.state.setStep("analyze", "running");
      yield { type: "step-start", id: "analyze", title: "执行本地智能上下文演示" };
      if (options.signal.aborted) throw options.signal.reason;
      this.state.setStep("analyze", "completed");
      yield {
        type: "step-complete",
        id: "analyze",
        result: "已根据路径与内容相关性整理证据",
      };

      this.state.setStep("respond", "running");
      yield { type: "message-start" };
      const selectedPaths = selection.summary.files.map((file) => file.path);
      const content = [
        `已收到任务：“${task}”。`,
        "",
        formatProjectSummary(project),
        "",
        `本次在 ${selection.summary.budgetTokens} Token 预算内选择了：`,
        ...selectedPaths.map((path) => `- ${path}`),
        "",
        selection.summary.truncated
          ? `另有 ${selection.summary.omittedFiles} 个候选文件未放入上下文，避免发送整个项目。`
          : "候选上下文未发生裁剪。",
        "当前为 Mock 模式，不进行模型推理；上述扫描、读取、排序和 Token 控制均为真实本地操作。",
        "配置 CODEMUSE_API_KEY 后，精选代码片段会交给 DeepSeek、GLM 或兼容模型继续分析。",
      ].join("\n");

      for (let offset = 0; offset < content.length; offset += 16) {
        if (options.signal.aborted) throw options.signal.reason;
        yield { type: "message-delta", content: content.slice(offset, offset + 16) };
        await wait(1, options.signal);
      }
      yield { type: "message-complete" };
      this.state.setStep("respond", "completed");
      yield { type: "complete", summary: "Mock 任务规划与上下文选择完成" };
    } catch (error) {
      if (options.signal.aborted) {
        this.state.failRunningSteps("cancelled");
        yield { type: "notice", message: "任务已取消" };
        return;
      }
      this.state.failRunningSteps("failed");
      const message = error instanceof Error ? error.message : String(error);
      yield { type: "error", message };
    }
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
