const enabled = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

function wrap(code: number, value: string): string {
  return enabled ? `\u001B[${code}m${value}\u001B[0m` : value;
}

export const color = {
  brand: (value: string) => wrap(36, value),
  muted: (value: string) => wrap(90, value),
  success: (value: string) => wrap(32, value),
  warning: (value: string) => wrap(33, value),
  error: (value: string) => wrap(31, value),
  bold: (value: string) => wrap(1, value),
};
