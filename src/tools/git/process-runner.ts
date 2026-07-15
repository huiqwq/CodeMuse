import { spawn, type ChildProcess } from "node:child_process";

const MAX_OUTPUT_BYTES = 80_000;
const SENSITIVE_NAME = /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PRIVATE_?KEY)(?:_|$)/i;

export type GitProcessRequest = {
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
};

export type GitProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputTruncated: boolean;
  durationMs: number;
};

export type GitProcessRunner = (
  request: GitProcessRequest,
) => Promise<GitProcessResult>;

export const runGitProcess: GitProcessRunner = async (request) => {
  if (request.signal.aborted) throw request.signal.reason;
  const startedAt = Date.now();

  return new Promise<GitProcessResult>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let capturedBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn("git", request.args, {
      cwd: request.cwd,
      env: buildSafeGitEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const capture = (chunks: Buffer[], chunk: Buffer): void => {
      const remaining = MAX_OUTPUT_BYTES - capturedBytes;
      if (remaining <= 0) {
        outputTruncated = true;
        return;
      }
      const selected = chunk.length <= remaining
        ? chunk
        : chunk.subarray(0, remaining);
      chunks.push(selected);
      capturedBytes += selected.length;
      if (selected.length < chunk.length) outputTruncated = true;
    };

    child.stdout.on("data", (chunk: Buffer) => capture(stdoutChunks, chunk));
    child.stderr.on("data", (chunk: Buffer) => capture(stderrChunks, chunk));

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, request.timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      terminate(child);
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
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        timedOut,
        outputTruncated,
        durationMs: Date.now() - startedAt,
      });
    });
  });
};

function buildSafeGitEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name, value]) =>
      value !== undefined && !SENSITIVE_NAME.test(name)
    ),
  );
}

function terminate(child: ChildProcess): void {
  child.kill("SIGKILL");
}
