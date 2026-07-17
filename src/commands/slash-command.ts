export type ModelCommandAction =
  | "show"
  | "list"
  | "use"
  | "test"
  | "init"
  | "reload"
  | "unknown";

export type PlanCommandAction =
  | "status"
  | "on"
  | "revise"
  | "approve"
  | "off";

export type GoalCommandAction =
  | "create"
  | "status"
  | "pause"
  | "resume"
  | "complete"
  | "cancel"
  | "history";

export type MemoryCommandAction =
  | "list"
  | "show"
  | "add"
  | "forget"
  | "clear";

export type SlashCommand =
  | { name: "help" }
  | { name: "clear" }
  | { name: "cancel" }
  | { name: "model"; action: ModelCommandAction; value?: string }
  | { name: "review"; mode: "report" | "fix"; target?: string }
  | { name: "paste" }
  | { name: "usage" }
  | { name: "workspace" }
  | { name: "plan"; action: PlanCommandAction; value?: string }
  | { name: "goal"; action: GoalCommandAction; value?: string }
  | { name: "memory"; action: MemoryCommandAction; value?: string }
  | { name: "approval"; mode?: "strict" | "plan-scoped" }
  | { name: "doctor"; action: "run" | "export" }
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
    case "context":
    case "scan":
    case "undo":
    case "history":
    case "exit":
      return { name };
    case "doctor":
      return argumentsList[0]?.toLowerCase() === "export"
        ? { name, action: "export" }
        : argumentsList.length === 0
        ? { name, action: "run" }
        : { name: "unknown", value: `doctor ${argumentsList.join(" ")}` };
    case "plan":
      return parsePlanCommand(argumentsList);
    case "goal":
      return parseGoalCommand(argumentsList);
    case "memory":
      return parseMemoryCommand(argumentsList);
    case "approval":
      return parseApprovalCommand(argumentsList);
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

function parsePlanCommand(argumentsList: string[]): SlashCommand {
  const [rawAction = "", ...rest] = argumentsList;
  const action = rawAction.toLowerCase();
  const value = rest.join(" ").trim();
  switch (action) {
    case "":
    case "status":
      return { name: "plan", action: "status" };
    case "on":
    case "approve":
    case "off":
      return { name: "plan", action };
    case "revise":
      return value
        ? { name: "plan", action, value }
        : { name: "plan", action };
    default:
      return { name: "unknown", value: `plan ${argumentsList.join(" ")}` };
  }
}

function parseGoalCommand(argumentsList: string[]): SlashCommand {
  const [rawAction = "", ...rest] = argumentsList;
  const action = rawAction.toLowerCase();
  const value = rest.join(" ").trim();
  switch (action) {
    case "":
    case "status":
      return { name: "goal", action: "status" };
    case "create":
      return value
        ? { name: "goal", action, value }
        : { name: "goal", action };
    case "pause":
    case "resume":
    case "complete":
    case "cancel":
    case "history":
      return { name: "goal", action };
    default:
      return { name: "unknown", value: `goal ${argumentsList.join(" ")}` };
  }
}

function parseMemoryCommand(argumentsList: string[]): SlashCommand {
  const [rawAction = "", ...rest] = argumentsList;
  const action = rawAction.toLowerCase();
  const value = rest.join(" ").trim();
  switch (action) {
    case "":
    case "list":
      return { name: "memory", action: "list" };
    case "clear":
      return { name: "memory", action };
    case "show":
    case "add":
    case "forget":
      return value
        ? { name: "memory", action, value }
        : { name: "memory", action };
    default:
      return { name: "unknown", value: `memory ${argumentsList.join(" ")}` };
  }
}

function parseApprovalCommand(argumentsList: string[]): SlashCommand {
  const value = argumentsList.join(" ").trim().toLowerCase();
  if (!value) return { name: "approval" };
  if (value === "strict" || value === "plan-scoped") {
    return { name: "approval", mode: value };
  }
  return { name: "unknown", value: `approval ${value}` };
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
  /plan on              进入持续规划模式（只读）
  /plan status          查看结构化计划
  /plan revise <要求>   修订当前计划
  /plan approve         批准并执行当前计划
  /plan off             退出规划模式
  /goal create <目标>   创建可恢复的长期目标
  /goal status          查看目标进度与预算
  /goal pause|resume    暂停或恢复目标
  /goal complete        在存在验证证据时完成目标
  /goal cancel|history  取消目标或查看历史
  /memory list          查看项目记忆
  /memory show <ID>     查看记忆详情
  /memory add <内容>    保存用户确认的项目记忆
  /memory forget <ID>   遗忘一条项目记忆
  /memory clear         清空当前项目记忆
  /approval [MODE]      查看或设置 strict / plan-scoped
  /doctor               诊断运行环境
  /doctor export        生成已脱敏的本地诊断记录
  /context              查看最近一次上下文选择
  /scan                 重新扫描当前项目
  /undo                 撤销当前进程最近一次任务修改
  /history              查看当前工作区最近 10 条会话
  /resume [ID]          恢复指定会话，省略 ID 时恢复最新会话
  /clear                清空终端和当前任务状态
  /cancel               取消当前任务
  /exit                 退出 CodeMuse

PowerShell 安全凭据：codemuse auth login/status/logout`;
