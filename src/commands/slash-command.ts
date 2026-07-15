export type ModelCommandAction =
  | "show"
  | "list"
  | "use"
  | "test"
  | "init"
  | "reload"
  | "unknown";

export type SlashCommand =
  | { name: "help" }
  | { name: "clear" }
  | { name: "cancel" }
  | { name: "model"; action: ModelCommandAction; value?: string }
  | { name: "review"; mode: "report" | "fix"; target?: string }
  | { name: "paste" }
  | { name: "usage" }
  | { name: "workspace" }
  | { name: "plan" }
  | { name: "context" }
  | { name: "scan" }
  | { name: "undo" }
  | { name: "history" }
  | { name: "resume"; id?: string }
  | { name: "exit" }
  | { name: "unknown"; value: string };

export function parseSlashCommand(input: string): SlashCommand | null {
  const value = input.trim();
  if (!value.startsWith("/")) return null;
  const [rawName = "", ...argumentsList] = value.slice(1).split(/\s+/);
  const name = rawName.toLowerCase();

  switch (name) {
    case "help":
    case "clear":
    case "cancel":
    case "usage":
    case "workspace":
    case "plan":
    case "context":
    case "scan":
    case "undo":
    case "history":
    case "exit":
      return { name };
    case "model":
      return parseModelCommand(argumentsList);
    case "review":
      return parseReviewCommand(argumentsList);
    case "paste":
      return { name: "paste" };
    case "resume": {
      const id = argumentsList.join(" ").trim();
      return id ? { name, id } : { name };
    }
    default:
      return { name: "unknown", value: name };
  }
}

function parseModelCommand(argumentsList: string[]): SlashCommand {
  const [rawAction = "", ...rest] = argumentsList;
  const action = rawAction.toLowerCase();
  const value = rest.join(" ").trim();

  switch (action) {
    case "":
      return { name: "model", action: "show" };
    case "list":
    case "init":
    case "reload":
      return { name: "model", action };
    case "use":
      return value
        ? { name: "model", action, value }
        : { name: "model", action };
    case "test":
      return value
        ? { name: "model", action, value }
        : { name: "model", action };
    default:
      return {
        name: "model",
        action: "unknown",
        value: [rawAction, ...rest].join(" ").trim(),
      };
  }
}

function parseReviewCommand(argumentsList: string[]): SlashCommand {
  const mode = argumentsList.includes("--fix") ? "fix" : "report";
  const targetParts = argumentsList.filter((value) => value !== "--fix");
  if (targetParts.some((value) => value.startsWith("--"))) {
    return {
      name: "unknown",
      value: "review " + argumentsList.join(" "),
    };
  }
  const target = targetParts.join(" ").trim();
  return target
    ? { name: "review", mode, target }
    : { name: "review", mode };
}

export const HELP_TEXT = `可用命令
  /help                 查看帮助
  /model                查看当前模型和配置文件位置
  /model list           查看全部模型 Profile
  /model use <NAME>     切换模型，mock 表示本地演示
  /model test [NAME]    发送最小 API 连接测试
  /model init           创建本机配置模板
  /model reload         重新读取本机配置、凭据和环境变量
  /review [PATH]        只读审查项目或指定文件
  /review --fix [PATH]   审查、确认修改并验证
  /paste                粘贴临时代码，输入 .end 开始审查
  /usage                查看当前进程 Token 用量
  /workspace            查看当前工作区
  /plan                 查看最近一次任务计划
  /context              查看最近一次上下文选择
  /scan                 重新扫描当前项目
  /undo                 撤销当前进程最近一次任务修改
  /history              查看当前工作区最近 10 条会话
  /resume [ID]          恢复指定会话，省略 ID 时恢复最新会话
  /clear                清空终端和当前任务状态
  /cancel               取消当前任务
  /exit                 退出 CodeMuse

PowerShell 安全凭据：codemuse auth login/status/logout`;
