import {
  diagnoseScriptFailure,
  formatRepairContext,
  type FailureDiagnostics,
} from "./failure-diagnostics.ts";
import type { ApplyPatchOutput } from "../tools/patch/apply-patch.ts";
import type { RunScriptOutput } from "../tools/scripts/run-script.ts";

const MAX_APPLIED_PATCHES = 3;
const MAX_IDENTICAL_FAILURES = 2;

export type RepairObservation = {
  modelContext?: string;
  notice?: string;
  stoppedReason?: string;
  diagnostics?: FailureDiagnostics;
};

type ActiveFailure = {
  script: string;
  fingerprint: string;
  occurrences: number;
};

export class RepairPolicy {
  private readonly workspaceRoot: string;
  private activeFailure: ActiveFailure | null = null;
  private appliedPatches = 0;
  private stoppedReason: string | null = null;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  beforeTool(toolName: string): string | null {
    if (this.stoppedReason) return this.stoppedReason;
    if (
      toolName === "apply_patch" &&
      this.activeFailure &&
      this.appliedPatches >= MAX_APPLIED_PATCHES
    ) {
      this.stoppedReason = `已达到单任务 ${MAX_APPLIED_PATCHES} 个修复补丁上限`;
      return this.stoppedReason;
    }
    return null;
  }

  observe(toolName: string, value: unknown): RepairObservation {
    if (toolName === "apply_patch" && isApplyPatchOutput(value) && value.applied) {
      if (!this.activeFailure) return {};
      this.appliedPatches += 1;
      return {
        notice: `已应用第 ${this.appliedPatches}/${MAX_APPLIED_PATCHES} 个修复补丁，请重新运行 ${this.activeFailure.script} 验证`,
        modelContext: `CodeMuse 修复策略：补丁已应用。下一步应重新运行 ${this.activeFailure.script}；如果还需要补丁，必须先根据新的失败证据读取相关文件。`,
      };
    }

    if (toolName !== "run_script" || !isRunScriptOutput(value) || !value.executed) {
      return {};
    }

    if (value.success) {
      if (!this.activeFailure || this.activeFailure.script !== value.script) return {};
      this.activeFailure = null;
      return {
        notice: `验证通过：${value.script} 已成功，自动修复闭环完成`,
        modelContext: `CodeMuse 验证结果：${value.script} 已通过。最终回答必须说明实际执行命令和成功退出码。`,
      };
    }

    const diagnostics = diagnoseScriptFailure(value, this.workspaceRoot);
    if (!diagnostics) return {};
    const previousFailure = this.activeFailure;
    const sameFailure = previousFailure !== null &&
      previousFailure.script === diagnostics.script &&
      previousFailure.fingerprint === diagnostics.fingerprint;
    const activeFailure: ActiveFailure = sameFailure
      ? {
          ...previousFailure,
          occurrences: previousFailure.occurrences + 1,
        }
      : {
          script: diagnostics.script,
          fingerprint: diagnostics.fingerprint,
          occurrences: 1,
        };
    this.activeFailure = activeFailure;

    if (activeFailure.occurrences >= MAX_IDENTICAL_FAILURES) {
      this.stoppedReason =
        `脚本 ${diagnostics.script} 连续出现相同失败（指纹 ${diagnostics.fingerprint}），为避免无效循环已停止自动修复`;
    }

    const locationSummary = diagnostics.locations.length
      ? `，定位 ${diagnostics.locations.length} 处代码位置`
      : "，未从输出中提取到代码位置";
    return {
      diagnostics,
      notice: this.stoppedReason ??
        `已诊断 ${diagnostics.script} 失败：${diagnostics.category}${locationSummary}`,
      modelContext: formatRepairContext(diagnostics, this.appliedPatches),
      ...(this.stoppedReason ? { stoppedReason: this.stoppedReason } : {}),
    };
  }
}

function isApplyPatchOutput(value: unknown): value is ApplyPatchOutput {
  return Boolean(
    value && typeof value === "object" &&
      "applied" in value && typeof value.applied === "boolean" &&
      "path" in value && typeof value.path === "string",
  );
}

function isRunScriptOutput(value: unknown): value is RunScriptOutput {
  return Boolean(
    value && typeof value === "object" &&
      "script" in value && typeof value.script === "string" &&
      "executed" in value && typeof value.executed === "boolean" &&
      "success" in value && typeof value.success === "boolean",
  );
}
