export type SlashCommand =
  | { name: "help" }
  | { name: "clear" }
  | { name: "cancel" }
  | { name: "model" }
  | { name: "workspace" }
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
  /clear      清空终端显示
  /cancel     取消当前任务
  /exit       退出 CodeMuse`;
