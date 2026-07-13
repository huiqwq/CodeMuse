import type { StepStatus, TaskPlan } from "../types.ts";

export function createTaskPlan(task: string): TaskPlan {
  return {
    task,
    steps: [
      { id: "scan", title: "扫描项目并识别技术栈", status: "pending" },
      { id: "context", title: "筛选与任务相关的代码上下文", status: "pending" },
      { id: "analyze", title: "分析证据并按需调用只读工具", status: "pending" },
      { id: "respond", title: "整理结论并返回结果", status: "pending" },
    ],
  };
}

export function setPlanStepStatus(
  plan: TaskPlan,
  stepId: string,
  status: StepStatus,
): void {
  const step = plan.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`任务计划中不存在步骤：${stepId}`);
  step.status = status;
}
