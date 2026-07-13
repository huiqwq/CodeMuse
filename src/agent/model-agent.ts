import { openWorkspace } from "../context/workspace.ts";
import type {
  AgentEvent,
  AgentRunOptions,
  AgentRunner,
  ChatMessage,
  ModelProvider,
  ToolCall,
} from "../types.ts";
import type { ToolRegistry } from "../tools/registry.ts";

const MAX_MODEL_TURNS = 12;

const SYSTEM_PROMPT = `你是 CodeMuse，一个运行在用户终端中的只读代码库分析 Agent。
你可以使用 list_files、read_file 和 search_code 查看当前工作区。
分析项目时必须先调用工具获取证据，不得假装已经读取未读取的文件。
所有路径必须使用工作区相对路径。你不能修改文件、执行 Shell 或 Git 写操作。
工具失败时根据错误调整参数，不要编造结果。
最终回答应引用实际文件路径，明确区分代码事实与推断，并保持简洁。`;

type PendingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export class ModelAgent implements AgentRunner {
  readonly mode = "model" as const;
  readonly modelName: string;
  private readonly provider: ModelProvider;
  private readonly tools: ToolRegistry;

  constructor(provider: ModelProvider, tools: ToolRegistry) {
    this.provider = provider;
    this.tools = tools;
    this.modelName = provider.name;
  }

  async *run(
    task: string,
    options: AgentRunOptions,
  ): AsyncGenerator<AgentEvent> {
    try {
      const workspace = await openWorkspace(options.workspace);
      const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `工作区：${workspace.root}\n\n用户任务：${task}`,
        },
      ];
      let toolExecutions = 0;

      for (let turn = 1; turn <= MAX_MODEL_TURNS; turn += 1) {
        if (options.signal.aborted) throw options.signal.reason;

        yield { type: "step-start", id: `model-${turn}`, title: "模型分析下一步" };
        const calls = new Map<number, PendingToolCall>();
        let content = "";
        let messageStarted = false;

        for await (const event of this.provider.stream(
          messages,
          this.tools.definitions(),
          options.signal,
        )) {
          if (event.type === "text-delta") {
            if (!messageStarted) {
              messageStarted = true;
              yield { type: "message-start" };
            }
            content += event.content;
            yield { type: "message-delta", content: event.content };
          } else if (event.type === "tool-call-delta") {
            const current = calls.get(event.index) ?? {
              id: `tool-${turn}-${event.index}`,
              name: "",
              arguments: "",
            };
            if (event.id) current.id = event.id;
            if (event.name) current.name += event.name;
            if (event.arguments) current.arguments += event.arguments;
            calls.set(event.index, current);
          }
        }

        if (messageStarted) yield { type: "message-complete" };

        const toolCalls: ToolCall[] = [...calls.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, call]) => call);

        messages.push({
          role: "assistant",
          content: content || null,
          ...(toolCalls.length ? { toolCalls } : {}),
        });

        if (toolCalls.length === 0) {
          if (!content.trim()) throw new Error("模型没有返回文本或工具调用");
          yield { type: "step-complete", id: `model-${turn}`, result: "分析完成" };
          yield {
            type: "complete",
            summary: `只读分析完成，共执行 ${toolExecutions} 次工具调用`,
          };
          return;
        }

        yield {
          type: "step-complete",
          id: `model-${turn}`,
          result: `请求 ${toolCalls.length} 个只读工具`,
        };

        for (const call of toolCalls) {
          if (options.signal.aborted) throw options.signal.reason;
          toolExecutions += 1;
          yield {
            type: "tool-start",
            id: call.id,
            name: call.name || "unknown",
            summary: describeToolCall(call),
          };

          try {
            const result = await this.tools.execute(call, workspace, options.signal);
            yield {
              type: "tool-complete",
              id: call.id,
              name: call.name,
              summary: result.summary,
            };
            messages.push({
              role: "tool",
              toolCallId: call.id,
              content: result.modelContent,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            yield { type: "tool-failed", id: call.id, name: call.name, error: message };
            messages.push({
              role: "tool",
              toolCallId: call.id,
              content: JSON.stringify({ error: message }),
            });
          }
        }
      }

      throw new Error(`达到最大模型轮数 ${MAX_MODEL_TURNS}，任务已停止`);
    } catch (error) {
      if (options.signal.aborted) {
        yield { type: "notice", message: "任务已取消" };
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      yield { type: "error", message };
    }
  }
}

function describeToolCall(call: ToolCall): string {
  const value = call.arguments.trim();
  return value.length <= 120 ? value || "{}" : `${value.slice(0, 120)}...`;
}
