import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

const MAX_OUTPUT_BYTES = 80_000;
const SENSITIVE_ENVIRONMENT_NAMES = new Set([
  "CODEMUSE_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "ZHIPUAI_API_KEY",
]);

export type NpmInvocation = {
  command: string;
  prefixArgs: string[];
};

export function resolveNpmInvocation(
  environment: NodeJS.ProcessEnv = process.env,
  execPath = process.execPath,
  platform = process.platform,
): NpmInvocation {
  if (platform !== "win32") {
    return { command: "npm", prefixArgs: [] };
  }

  const environmentCli = environment.npm_execpath;
  const bundledCli = join(dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const npmCli = environmentCli &&
      isAbsolute(environmentCli) &&
      environmentCli.toLowerCase().endsWith(".js") &&
      existsSync(environmentCli)
    ? environmentCli
    : bundledCli;

  if (!existsSync(npmCli)) {
    throw new Error("无法定位 npm-cli.js，请确认 Node.js 安装包含 npm");
  }
  return {
    command: execPath,
    prefixArgs: [npmCli],
  };
}
export type ScriptProcessRequest = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal: AbortSignal;
};

export type ScriptProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputTruncated: boolean;
  durationMs: number;
};

export type ScriptProcessRunner = (
  request: ScriptProcessRequest,
) => Promise<ScriptProcessResult>;

export const runScriptProcess: ScriptProcessRunner = async (request) => {
  if (request.signal.aborted) throw request.signal.reason;
  const startedAt = Date.now();

  return new Promise<ScriptProcessResult>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let capturedBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const capture = (chunks: Buffer[], chunk: Buffer): void => {
      const remaining = MAX_OUTPUT_BYTES - capturedBytes;
      if (remaining <= 0) {
        outputTruncated = true;
        return;
      }
      const selected = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
      chunks.push(selected);
      capturedBytes += selected.length;
      if (selected.length < chunk.length) outputTruncated = true;
    };

    child.stdout.on("data", (chunk: Buffer) => capture(stdoutChunks, chunk));
    child.stderr.on("data", (chunk: Buffer) => capture(stderrChunks, chunk));

    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, request.timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      terminateProcessTree(child);
      cleanup();
      reject(request.signal.reason);
    };
    request.signal.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });

    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      const truncatedNotice = outputTruncated ? "\n...输出已截断" : "";
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: `${Buffer.concat(stderrChunks).toString("utf8")}${truncatedNotice}`,
        timedOut,
        outputTruncated,
        durationMs: Date.now() - startedAt,
      });
    });
  });
};

export function buildSafeScriptEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || isSensitiveEnvironmentName(name)) continue;
    environment[name] = value;
  }

  environment.npm_config_ignore_scripts = "true";
  return environment;
}

function isSensitiveEnvironmentName(name: string): boolean {
  const normalized = name.toUpperCase();
  if (SENSITIVE_ENVIRONMENT_NAMES.has(normalized)) return true;
  return /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PRIVATE_?KEY)(?:_|$)/.test(normalized);
}

function terminateProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    child.kill("SIGKILL");
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn(
      "taskkill",
      ["/pid", String(child.pid), "/T", "/F"],
      {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      },
    );
    killer.on("error", () => child.kill("SIGKILL"));
    return;
  }

  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}
