import { AgentStateStore } from "./agent-state.ts";
import {
  formatProjectSummary,
  selectTaskContext,
  type ContextSelection,
} from "../context/context-selector.ts";
import { scanProject } from "../context/project-scanner.ts";
import { openWorkspace } from "../context/workspace.ts";
import { createCodingToolRegistry } from "../tools/create-coding-tools.ts";
import type {
  AgentEvent,
  AgentRunOptions,
  AgentRunner,
  AgentSessionState,
  ProjectScan,
  UndoResult,
} from "../types.ts";
import type { ToolRegistry } from "../tools/registry.ts";

export class MockAgent implements AgentRunner {
  readonly mode = "mock" as const;
  readonly modelName: string;
  private readonly state = new AgentStateStore();
  private readonly contextTokenBudget: number;
  private readonly tools: ToolRegistry;

  constructor(
    contextTokenBudget = 6_000,
    tools: ToolRegistry = createCodingToolRegistry(),
    modelName = "Mock（Plan、Goal 与安全边界演示）",
  ) {
    this.modelName = modelName;
    this.contextTokenBudget = contextTokenBudget;
    this.tools = tools;
  }

  async scan(options: AgentRunOptions): Promise<ProjectScan> {
    const workspace = await openWorkspace(options.workspace);
    const project = await scanProject(workspace, options.signal);
    this.state.clear();
    this.state.setProject(project);
    return project;
  }

  async undo(options: AgentRunOptions): Promise<UndoResult> {
    const workspace = await openWorkspace(options.workspace);
    return this.tools.undoLatest(
      workspace,
      options.signal,
      options.requestApproval,
    );
  }

  getState(): AgentSessionState {
    return this.state.snapshot();
  }

  restoreState(state: AgentSessionState): void {
    this.state.restore(state);
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

      let project: ProjectScan;
      let selection: ContextSelection;
      if (options.contextMode === "none") {
        project = createStandaloneProject();
        selection = createStandaloneSelection();
        this.state.setStep("scan", "running");
        yield { type: "step-start", id: "scan", title: "保护本地工作区" };
        this.state.setProject(project);
        this.state.setStep("scan", "completed");
        yield { type: "project-scanned", project };
        yield { type: "step-complete", id: "scan", result: "未扫描本地项目" };
        this.state.setStep("context", "running");
        yield { type: "step-start", id: "context", title: "隔离粘贴代码片段" };
        this.state.setContext(selection.summary);
        this.state.setStep("context", "completed");
        yield { type: "context-selected", context: selection.summary };
        yield { type: "step-complete", id: "context", result: "未附加本地代码上下文" };
      } else {
      this.state.setStep("scan", "running");
      yield { type: "step-start", id: "scan", title: "扫描项目结构与技术栈" };
      project = await scanProject(workspace, options.signal);
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
      selection = await selectTaskContext(
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

      }

      this.state.setStep("analyze", "running");
      yield { type: "step-start", id: "analyze", title: "执行本地安全流程演示" };
      if (options.signal.aborted) throw options.signal.reason;
      this.state.setStep("analyze", "completed");
      yield {
        type: "step-complete",
        id: "analyze",
        result: "已整理上下文和安全写入边界",
      };

      this.state.setStep("respond", "running");
      yield { type: "message-start" };
      const selectedPaths = selection.summary.files.map((file) => file.path);
      const content = [
        `已收到任务：“${task}”。`,
        ...(options.resume
          ? [`已恢复会话 ${options.resume.sessionId}：${options.resume.priorTask}`]
          : []),
        "",
        formatProjectSummary(project),
        "",
        `本次在 ${selection.summary.budgetTokens} Token 预算内选择了：`,
        ...selectedPaths.map((path) => `- ${path}`),
        "",
        selection.summary.truncated
          ? `另有 ${selection.summary.omittedFiles} 个候选文件未放入上下文，避免发送整个项目。`
          : "候选上下文未发生裁剪。",
        "当前为 Mock 模式，不进行模型推理，不会自动生成补丁、执行 npm scripts 或模拟测试通过。",
        "使用 /model list 查看配置，/model use 切换模型，/model test 发送最小连接测试；真实请求会报告 Token 用量并仅对网络错误、429 和 5xx 有限重试。",
      ].join("\n");

      for (let offset = 0; offset < content.length; offset += 16) {
        if (options.signal.aborted) throw options.signal.reason;
        yield { type: "message-delta", content: content.slice(offset, offset + 16) };
        await wait(1, options.signal);
      }
      yield { type: "message-complete" };
      this.state.setStep("respond", "completed");
      yield {
        type: "complete",
        summary: "Mock Plan、Goal 与 API 安全边界演示完成；未产生代码修改",
        verified: true,
        validationCommands: [],
      };
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

function createStandaloneProject(): ProjectScan {
  return {
    projectName: "pasted-snippet",
    projectTypes: ["代码片段"],
    languages: [],
    frameworks: [],
    packageManager: null,
    fileCount: 0,
    files: [],
    keyFiles: [],
    truncated: false,
  };
}

function createStandaloneSelection(): ContextSelection {
  return {
    summary: {
      budgetTokens: 0,
      estimatedTokens: 0,
      files: [],
      omittedFiles: 0,
      truncated: false,
    },
    files: [],
    modelContent: "未读取或附加任何本地工作区文件。",
  };
}
