import { openWorkspace } from "../context/workspace.ts";
import type {
  AgentEvent,
  AgentRunOptions,
  AgentRunner,
  ToolCall,
} from "../types.ts";
import type { ToolRegistry } from "../tools/registry.ts";

export class MockAgent implements AgentRunner {
  readonly mode = "mock" as const;
  readonly modelName = "Mock (只读工具演示)";
  private readonly tools: ToolRegistry;

  constructor(tools: ToolRegistry) {
    this.tools = tools;
  }

  async *run(
    task: string,
    options: AgentRunOptions,
  ): AsyncGenerator<AgentEvent> {
    try {
      const workspace = await openWorkspace(options.workspace);
      const calls: ToolCall[] = [
        {
          id: "mock-list",
          name: "list_files",
          arguments: JSON.stringify({ path: ".", maxDepth: 2 }),
        },
        {
          id: "mock-read",
          name: "read_file",
          arguments: JSON.stringify({ path: "package.json", startLine: 1, endLine: 80 }),
        },
        {
          id: "mock-search",
          name: "search_code",
          arguments: JSON.stringify({ query: "CodeMuse", path: "src", maxResults: 20 }),
        },
      ];
      const summaries: string[] = [];

      yield { type: "step-start", id: "inspect", title: "执行本地只读分析演示" };
      for (const call of calls) {
        if (options.signal.aborted) throw options.signal.reason;
        yield {
          type: "tool-start",
          id: call.id,
          name: call.name,
          summary: call.arguments,
        };

        try {
          const result = await this.tools.execute(call, workspace, options.signal);
          summaries.push(`${call.name}: ${result.summary}`);
          yield {
            type: "tool-complete",
            id: call.id,
            name: call.name,
            summary: result.summary,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          summaries.push(`${call.name}: ${message}`);
          yield { type: "tool-failed", id: call.id, name: call.name, error: message };
        }
      }
      yield { type: "step-complete", id: "inspect", result: "只读工具演示完成" };

      yield { type: "message-start" };
      const content =
        `已收到任务：“${task}”。\n` +
        "当前处于 Mock 模式，但上面的文件列表、读取和搜索均为真实本地只读操作。\n" +
        `${summaries.join("\n")}\n` +
        "配置 CODEMUSE_API_KEY 后，模型会根据自然语言任务自主选择这些工具。";

      for (const character of content) {
        if (options.signal.aborted) throw options.signal.reason;
        yield { type: "message-delta", content: character };
        await wait(2, options.signal);
      }
      yield { type: "message-complete" };
      yield { type: "complete", summary: "Mock 只读分析完成" };
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
