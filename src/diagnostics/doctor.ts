import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { createCredentialStore } from "../credentials/credential-store.ts";
import { openWorkspace } from "../context/workspace.ts";

export type DoctorCheck = {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
};

export async function runDoctorChecks(
  workspaceRoot: string,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  checks.push(checkNodeVersion());

  try {
    const workspace = await openWorkspace(workspaceRoot);
    await access(workspace.root, constants.R_OK | constants.W_OK);
    checks.push({
      name: "workspace",
      status: "pass",
      message: "工作区可读写且路径有效",
    });
  } catch (error) {
    checks.push({
      name: "workspace",
      status: "fail",
      message: errorMessage(error),
    });
  }

  checks.push(await checkCommand("git", ["--version"], "git"));
  checks.push(await checkPackage(workspaceRoot));

  const credentials = createCredentialStore();
  checks.push({
    name: "credentials",
    status: credentials.protection === "unsupported" ? "warn" : "pass",
    message: credentials.protection === "unsupported"
      ? "当前平台没有安全凭据后端，只能使用环境变量"
      : `安全凭据后端：${credentials.protection}`,
  });
  return checks;
}

function checkNodeVersion(): DoctorCheck {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  const supported = major > 22 || major === 22 && minor >= 18;
  return {
    name: "node",
    status: supported ? "pass" : "fail",
    message: supported
      ? `Node.js ${process.versions.node}`
      : `需要 Node.js >=22.18.0，当前为 ${process.versions.node}`,
  };
}

async function checkPackage(workspaceRoot: string): Promise<DoctorCheck> {
  try {
    const value: unknown = JSON.parse(
      await readFile(`${workspaceRoot}/package.json`, "utf8"),
    );
    const scriptCount = value && typeof value === "object" &&
        "scripts" in value &&
        value.scripts &&
        typeof value.scripts === "object"
      ? Object.keys(value.scripts).length
      : 0;
    return {
      name: "project",
      status: "pass",
      message: `检测到 package.json 和 ${scriptCount} 个 scripts`,
    };
  } catch {
    return {
      name: "project",
      status: "warn",
      message: "未检测到有效 package.json；部分验证工具不可用",
    };
  }
}

function checkCommand(
  command: string,
  args: string[],
  name: string,
): Promise<DoctorCheck> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => child.kill(), 5_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => output += chunk);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ name, status: "warn", message: `${command} 不可用` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        name,
        status: code === 0 ? "pass" : "warn",
        message: code === 0 ? output.trim().slice(0, 200) : `${command} 检查失败`,
      });
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
