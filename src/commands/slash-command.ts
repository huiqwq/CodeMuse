export type SlashCommand =
  | { name: "help" }
  | { name: "clear" }
  | { name: "cancel" }
  | { name: "model" }
  | { name: "workspace" }
  | { name: "plan" }
  | { name: "context" }
  | { name: "scan" }
  | { name: "undo" }
  | { name: "exit" }
  | { name: "unknown"; value: string };

export function parseSlashCommand(input: string): SlashCommand | null {
  const value = input.trim();
  if (!value.startsWith("/")) return null;
  const name = value.slice(1).split(/\s+/, 1)[0].toLowerCase();

  switch (name) {
    case "help":
    case "clear":
    case "cancel":
    case "model":
    case "workspace":
    case "plan":
    case "context":
    case "scan":
    case "undo":
    case "exit":
      return { name };
    default:
      return { name: "unknown", value: name };
  }
}

export const HELP_TEXT = `可用命令
  /help       查看帮助
  /model      查看当前模型
  /workspace  查看当前工作区
  /plan       查看最近一次任务计划
  /context    查看最近一次上下文选择
  /scan       重新扫描当前项目
  /undo       撤销当前会话最近一次任务修改
  /clear      清空终端和当前任务状态
  /cancel     取消当前任务
  /exit       退出 CodeMuse`;
