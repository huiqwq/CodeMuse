import { createTaskPlan, setPlanStepStatus } from "./task-planner.ts";
import type {
  AgentSessionState,
  ContextSummary,
  ProjectScan,
  StepStatus,
} from "../types.ts";

export class AgentStateStore {
  private state: AgentSessionState = emptyState();

  begin(task: string): void {
    this.state = {
      project: null,
      plan: createTaskPlan(task),
      context: null,
    };
  }

  setProject(project: ProjectScan): void {
    this.state.project = project;
  }

  setContext(context: ContextSummary): void {
    this.state.context = context;
  }

  setStep(stepId: string, status: StepStatus): void {
    if (this.state.plan) setPlanStepStatus(this.state.plan, stepId, status);
  }

  failRunningSteps(status: "failed" | "cancelled"): void {
    if (!this.state.plan) return;
    for (const step of this.state.plan.steps) {
      if (step.status === "running") step.status = status;
    }
  }

  snapshot(): AgentSessionState {
    return structuredClone(this.state);
  }

  restore(state: AgentSessionState): void {
    this.state = structuredClone(state);
  }

  clear(): void {
    this.state = emptyState();
  }
}

function emptyState(): AgentSessionState {
  return { project: null, plan: null, context: null };
}
