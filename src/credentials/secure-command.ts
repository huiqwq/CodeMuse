import { spawn } from "node:child_process";

const TIMEOUT_MS = 15_000;
const MAX_OUTPUT = 128_000;

export async function runSecureCommand(
  command: string,
  args: string[],
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: safeEnvironment(env),
    });
    let stdout = "";
    let stderr = "";
    let exceeded = false;
    let timedOut = false;
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length + stderr.length > MAX_OUTPUT) {
        exceeded = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stdout.length + stderr.length > MAX_OUTPUT) {
        exceeded = true;
        child.kill();
      }
    });
    child.on("error", (error) =>
      finish(() => reject(new Error(`无法启动安全凭据后端：${safe(error.message)}`)))
    );
    child.on("close", (code) => finish(() => {
      if (timedOut) return reject(new Error("安全凭据操作超时"));
      if (exceeded) return reject(new Error("安全凭据后端输出超过限制"));
      if (code !== 0) {
        return reject(
          new Error(`安全凭据操作失败：${safe(stderr || `退出码 ${code}`)}`),
        );
      }
      resolve(stdout.trimEnd());
    }));
    child.stdin.end(input, "utf8");
  });
}

function safeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const names = [
    "HOME", "USER", "LOGNAME", "PATH", "LANG", "LC_ALL",
    "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR",
    "SystemRoot", "WINDIR", "TEMP", "TMP",
  ];
  return Object.fromEntries(
    names.flatMap((name) => env[name] ? [[name, env[name]]] : []),
  );
}

function safe(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .slice(0, 300);
}
