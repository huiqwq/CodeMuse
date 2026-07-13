import type {
  AgentEvent,
  AgentRunOptions,
  AgentRunner,
  ChatMessage,
  ModelProvider,
} from "../types.ts";

const SYSTEM_PROMPT = `你是 CodeMuse，一个运行在用户终端中的本地编程助手。
当前版本只提供问答能力，尚未获得读取或修改本地文件的工具权限。
请明确说明能力边界，不要声称已经查看、修改或执行用户的项目。
回答应简洁、准确，并优先给出可执行的下一步。`;

export class ModelAgent implements AgentRunner {
  readonly mode = "model" as const;
  readonly modelName: string;
  private readonly provider: ModelProvider;

  constructor(provider: ModelProvider) {
    this.provider = provider;
    this.modelName = provider.name;
  }

  async *run(
    task: string,
    options: AgentRunOptions,
  ): AsyncGenerator<AgentEvent> {
    yield { type: "step-start", id: "model", title: "请求模型" };
    yield { type: "message-start" };

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `工作区：${options.workspace}\n\n用户任务：${task}`,
      },
    ];

    try {
      for await (const content of this.provider.stream(messages, options.signal)) {
        yield { type: "message-delta", content };
      }
      yield { type: "message-complete" };
      yield { type: "step-complete", id: "model", result: "响应完成" };
      yield { type: "complete" };
    } catch (error) {
      if (options.signal.aborted) {
        yield { type: "notice", message: "任务已取消" };
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      yield { type: "message-complete" };
      yield { type: "step-failed", id: "model", error: message };
      yield { type: "error", message };
    }
  }
}
