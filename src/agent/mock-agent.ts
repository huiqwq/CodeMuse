import type { AgentEvent, AgentRunOptions, AgentRunner } from "../types.ts";

export class MockAgent implements AgentRunner {
  readonly mode = "mock" as const;
  readonly modelName = "Mock (本地演示)";

  async *run(
    task: string,
    options: AgentRunOptions,
  ): AsyncGenerator<AgentEvent> {
    const steps = [
      ["understand", "理解任务", "已提取用户目标"],
      ["plan", "生成执行计划", "已生成 3 个模拟步骤"],
      ["respond", "整理结果", "准备输出"],
    ] as const;

    try {
      for (const [id, title, result] of steps) {
        yield { type: "step-start", id, title };
        await wait(300, options.signal);
        yield { type: "step-complete", id, result };
      }

      yield { type: "message-start" };
      const content =
        `这是 Mock 模式的本地演示，已收到任务：“${task}”。\n` +
        "配置 CODEMUSE_API_KEY 后重新启动，即可使用真实 DeepSeek、GLM 或自定义兼容模型。";

      for (const character of content) {
        if (options.signal.aborted) break;
        yield { type: "message-delta", content: character };
        await wait(4, options.signal);
      }

      yield { type: "message-complete" };
      yield { type: "complete", summary: "模拟任务执行完成" };
    } catch {
      yield { type: "message-complete" };
      yield { type: "notice", message: "任务已取消" };
    }
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}
