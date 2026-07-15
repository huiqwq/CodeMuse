import { spawn } from "node:child_process";
import { join } from "node:path";
import type { CredentialProtector } from "./types.ts";

const PROCESS_TIMEOUT_MS = 15_000;
const MAX_PROCESS_OUTPUT = 128_000;
const ENTROPY_LABEL = "CodeMuse credential vault v1";

const PROTECT_SCRIPT = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security | Out-Null
$plainText = [Console]::In.ReadToEnd()
$data = [Text.Encoding]::UTF8.GetBytes($plainText)
$entropy = [Text.Encoding]::UTF8.GetBytes("${ENTROPY_LABEL}")
$cipher = [Security.Cryptography.ProtectedData]::Protect(
  $data,
  $entropy,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Convert]::ToBase64String($cipher))
`;

const UNPROTECT_SCRIPT = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security | Out-Null
$cipherText = [Console]::In.ReadToEnd().Trim()
$cipher = [Convert]::FromBase64String($cipherText)
$entropy = [Text.Encoding]::UTF8.GetBytes("${ENTROPY_LABEL}")
$data = [Security.Cryptography.ProtectedData]::Unprotect(
  $cipher,
  $entropy,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($data))
`;

export class WindowsDpapiProtector implements CredentialProtector {
  readonly name = "windows-dpapi";
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    if (process.platform !== "win32") {
      throw new Error("Windows DPAPI 凭据后端只能在 Windows 上使用");
    }
    this.env = env;
  }

  protect(secret: string): Promise<string> {
    return runPowerShell(PROTECT_SCRIPT, secret, this.env);
  }

  unprotect(payload: string): Promise<string> {
    return runPowerShell(UNPROTECT_SCRIPT, payload, this.env);
  }
}

async function runPowerShell(
  script: string,
  input: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const executable = join(
    env.SystemRoot || env.WINDIR || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodedCommand,
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: safeProcessEnvironment(env),
      },
    );

    let stdout = "";
    let stderr = "";
    let outputExceeded = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, PROCESS_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_PROCESS_OUTPUT) {
        outputExceeded = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > MAX_PROCESS_OUTPUT) {
        outputExceeded = true;
        child.kill();
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 Windows DPAPI：${safeError(error.message)}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("Windows DPAPI 操作超时"));
        return;
      }
      if (outputExceeded) {
        reject(new Error("Windows DPAPI 输出超过安全限制"));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `Windows DPAPI 操作失败：${safeError(stderr || `退出码 ${code}`)}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });

    child.stdin.end(input, "utf8");
  });
}

function safeProcessEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = [
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "PATHEXT",
    "PSModulePath",
    "TEMP",
    "TMP",
  ];
  return Object.fromEntries(
    allowed.flatMap((name) => env[name] ? [[name, env[name]]] : []),
  );
}

function safeError(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .slice(0, 300);
}
