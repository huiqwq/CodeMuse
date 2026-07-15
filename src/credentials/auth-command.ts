import type { Writable } from "node:stream";
import { stdin, stdout } from "node:process";
import {
  createCredentialStore,
  type CredentialStore,
} from "./credential-store.ts";
import { loadModelCatalog } from "../models/profile-store.ts";

export type AuthCommandOptions = {
  env?: NodeJS.ProcessEnv;
  store?: CredentialStore;
  readSecret?: (prompt: string) => Promise<string>;
  output?: Pick<Writable, "write">;
};

export async function runAuthCommand(
  args: string[],
  options: AuthCommandOptions = {},
): Promise<number> {
  const env = options.env ?? process.env;
  const store = options.store ?? createCredentialStore(env);
  const output = options.output ?? stdout;
  const readSecret = options.readSecret ?? readHiddenInput;
  const [rawAction = "help", rawProfile = ""] = args;
  const action = rawAction.toLowerCase();
  const profileName = rawProfile.trim().toLowerCase();

  try {
    switch (action) {
      case "login": {
        if (!profileName) throw new Error("用法：codemuse auth login <PROFILE>");
        const profile = await resolveProfile(profileName, store, env);
        const secret = await readSecret(
          `请输入 ${profile.name} 的 API Key（输入不会显示）: `,
        );
        await store.set(profile.apiKeyEnv, secret.trim());
        output.write(
          `已安全保存 ${profile.name} 凭据；${sharedProfileNotice(profile.apiKeyEnv)}\n`,
        );
        return 0;
      }
      case "logout": {
        if (!profileName) throw new Error("用法：codemuse auth logout <PROFILE>");
        const profile = await resolveProfile(profileName, store, env);
        const deleted = await store.delete(profile.apiKeyEnv);
        output.write(
          deleted
            ? `已删除 ${profile.name} 的持久凭据。\n`
            : `${profile.name} 没有持久凭据。\n`,
        );
        if (env[profile.apiKeyEnv]) {
          output.write(
            `当前进程仍设置了 ${profile.apiKeyEnv}，环境变量会继续生效。\n`,
          );
        }
        return 0;
      }
      case "status": {
        const storedIds = new Set(await store.listIds());
        const markers = new Map([...storedIds].map((id) => [id, "stored"]));
        const catalog = await loadModelCatalog(env, markers);
        output.write(`凭据后端：${store.protection}\n`);
        output.write(`凭据文件：${store.path}\n`);
        for (const profile of catalog.profiles) {
          if (profile.name === "environment") continue;
          const state = env[profile.apiKeyEnv]?.trim()
            ? "环境变量"
            : storedIds.has(profile.apiKeyEnv)
            ? "已安全保存"
            : "未配置";
          output.write(
            `  ${profile.name}  ${profile.provider}/${profile.model}  ${state}\n`,
          );
        }
        return 0;
      }
      case "help":
      case "--help":
      case "-h":
        output.write(AUTH_HELP);
        return 0;
      default:
        throw new Error(`未知 auth 操作：${rawAction}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.write(`认证操作失败：${safeText(message)}\n`);
    return 1;
  }
}

async function resolveProfile(
  name: string,
  store: CredentialStore,
  env: NodeJS.ProcessEnv,
) {
  const storedIds = await store.listIds();
  const markers = new Map(storedIds.map((id) => [id, "stored"]));
  const catalog = await loadModelCatalog(env, markers);
  const profile = catalog.profiles.find((item) => item.name === name);
  if (!profile || profile.name === "environment") {
    throw new Error(`不存在可保存凭据的 Profile：${name}`);
  }
  return profile;
}

async function readHiddenInput(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || !stdin.setRawMode) {
    throw new Error("安全录入 API Key 需要交互式终端");
  }

  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise<string>((resolve, reject) => {
    let value = "";

    const cleanup = (): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          cleanup();
          reject(new Error("用户取消凭据录入"));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " " && character !== "\u007f") {
          value += character;
          if (value.length > 16_384) {
            cleanup();
            reject(new Error("API Key 超过长度限制"));
            return;
          }
        }
      }
    };

    stdin.on("data", onData);
  });
}

function sharedProfileNotice(apiKeyEnv: string): string {
  return apiKeyEnv === "ZHIPUAI_API_KEY"
    ? "glm 与 glm-flash 会共用该凭据"
    : "以后启动 CodeMuse 会自动读取";
}

function safeText(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .slice(0, 300);
}

const AUTH_HELP = `CodeMuse 安全凭据

  codemuse auth login <PROFILE>   隐藏输入并保存 API Key
  codemuse auth status            查看配置状态，不显示 API Key
  codemuse auth logout <PROFILE>  删除持久凭据

环境变量优先于持久凭据。Windows 使用绑定当前用户的 DPAPI 加密。
`;
