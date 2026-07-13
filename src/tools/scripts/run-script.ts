import { randomUUID } from "node:crypto";
import {
  buildSafeScriptEnvironment,
  runScriptProcess,
  resolveNpmInvocation,
  type ScriptProcessRunner,
} from "./process-runner.ts";
import {
  isAllowedScriptName,
  readPackageScripts,
} from "./package-scripts.ts";
import {
  expectObject,
  optionalInteger,
  requiredString,
} from "../registry.ts";
import type { AgentTool, ToolContext } from "../types.ts";

const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

export type RunScriptInput = {
  script: string;
  timeoutMs: number;
};

export type RunScriptOutput = {
  script: string;
  command: string;
  scriptBody: string;
  executed: boolean;
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputTruncated: boolean;
  durationMs: number;
  message: string;
};

export class RunScriptTool implements AgentTool<RunScriptInput, RunScriptOutput> {
  readonly risk = "execute" as const;
  readonly definition = {
    type: "function" as const,
    function: {
      name: "run_script",
      description:
        "执行 package.json 中允许的验证脚本。仅支持 test/build/lint/typecheck/check 类名称，执行前展示脚本并请求确认。",
      parameters: {
        type: "object",
        properties: {
          script: {
            type: "string",
            description: "必须来自 list_scripts 且标记为允许执行的脚本名称",
          },
          timeoutMs: {
            type: "integer",
            minimum: MIN_TIMEOUT_MS,
            maximum: MAX_TIMEOUT_MS,
            description: "超时时间，默认 60000 毫秒",
          },
        },
        required: ["script"],
        additionalProperties: false,
      },
    },
  };

  private readonly runner: ScriptProcessRunner;

  constructor(runner: ScriptProcessRunner = runScriptProcess) {
    this.runner = runner;
  }

  validate(input: unknown): RunScriptInput {
    const object = expectObject(input, "run_script");
    return {
      script: requiredString(object, "script"),
      timeoutMs: optionalInteger(
        object,
        "timeoutMs",
        DEFAULT_TIMEOUT_MS,
        MIN_TIMEOUT_MS,
        MAX_TIMEOUT_MS,
      ),
    };
  }

  async execute(
    input: RunScriptInput,
    context: ToolContext,
  ): Promise<RunScriptOutput> {
    if (!context.hasListedScripts()) {
      throw new Error("执行脚本前必须先在当前任务中使用 list_scripts");
    }

    const snapshot = await readPackageScripts(context.workspace);
    const script = snapshot.scripts.find((item) => item.name === input.script);
    if (!script) throw new Error(`package.json 中不存在脚本：${input.script}`);
    if (!isAllowedScriptName(script.name) || !script.allowed) {
      throw new Error(
        `脚本 ${script.name} 不在允许范围，仅支持 test/build/lint/typecheck/check 类脚本`,
      );
    }

    const command = `npm run ${script.name} --ignore-scripts`;
    const decision = await context.requestApproval({
      id: randomUUID(),
      kind: "execute",
      title: `确认执行 npm 脚本：${script.name}`,
      summary: `超时 ${input.timeoutMs}ms，自动隐藏敏感环境变量`,
      paths: ["package.json"],
      diff: [
        "Command:",
        `  ${command}`,
        "package.json:",
        `  ${JSON.stringify(script.name)}: ${JSON.stringify(script.command)}`,
      ].join("\n"),
    }, context.signal);

    if (decision !== "approved") {
      return deniedOutput(script.name, command, script.command);
    }
    if (context.signal.aborted) throw context.signal.reason;

    const invocation = resolveNpmInvocation();
    const result = await this.runner({
      command: invocation.command,
      args: [...invocation.prefixArgs, "run", script.name, "--ignore-scripts"],
      cwd: context.workspace.root,
      env: buildSafeScriptEnvironment(),
      timeoutMs: input.timeoutMs,
      signal: context.signal,
    });

    const success = result.exitCode === 0 && !result.timedOut;
    return {
      script: script.name,
      command,
      scriptBody: script.command,
      executed: true,
      success,
      ...result,
      message: result.timedOut
        ? "脚本执行超时"
        : success
          ? "脚本执行成功"
          : `脚本执行失败，退出码 ${result.exitCode ?? "unknown"}`,
    };
  }

  summarize(output: RunScriptOutput): string {
    if (!output.executed) return `未执行 ${output.script}（用户拒绝）`;
    if (output.timedOut) return `${output.script} 执行超时`;
    return `${output.script} 退出码 ${output.exitCode ?? "unknown"}`;
  }

  display(output: RunScriptOutput): string | undefined {
    if (!output.executed) return undefined;
    return [
      `$ ${output.command}`,
      `状态：${output.message}，耗时 ${output.durationMs}ms`,
      output.stdout ? `stdout:\n${output.stdout.trimEnd()}` : "",
      output.stderr ? `stderr:\n${output.stderr.trimEnd()}` : "",
    ].filter(Boolean).join("\n");
  }
}

function deniedOutput(
  script: string,
  command: string,
  scriptBody: string,
): RunScriptOutput {
  return {
    script,
    command,
    scriptBody,
    executed: false,
    success: false,
    exitCode: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    outputTruncated: false,
    durationMs: 0,
    message: "用户拒绝执行",
  };
}
