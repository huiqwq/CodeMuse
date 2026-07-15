import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { runAuthCommand } from "../src/credentials/auth-command.ts";
import { CredentialStore } from "../src/credentials/credential-store.ts";
import type { CredentialProtector } from "../src/credentials/types.ts";
import { loadModelCatalog } from "../src/models/profile-store.ts";

class FakeProtector implements CredentialProtector {
  readonly name = "test-protector";

  async protect(secret: string): Promise<string> {
    return Buffer.from("protected:" + secret, "utf8").toString("base64");
  }

  async unprotect(payload: string): Promise<string> {
    const value = Buffer.from(payload, "base64").toString("utf8");
    if (!value.startsWith("protected:")) throw new Error("测试密文无效");
    return value.slice("protected:".length);
  }
}

test("CredentialStore 只保存密文并支持读取和删除", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemuse-credentials-"));
  try {
    const path = join(root, "credentials.json");
    const store = new CredentialStore({
      path,
      protector: new FakeProtector(),
    });
    await store.set("DEEPSEEK_API_KEY", "secret-value");

    const text = await readFile(path, "utf8");
    assert.doesNotMatch(text, /secret-value/);
    assert.match(text, /test-protector/);
    assert.deepEqual(await store.listIds(), ["DEEPSEEK_API_KEY"]);
    assert.equal((await store.load()).get("DEEPSEEK_API_KEY"), "secret-value");

    assert.equal(await store.delete("DEEPSEEK_API_KEY"), true);
    assert.equal(await store.delete("DEEPSEEK_API_KEY"), false);
    assert.deepEqual(await store.listIds(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CredentialStore 拒绝未知字段和无效密文", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemuse-credentials-invalid-"));
  try {
    const path = join(root, "credentials.json");
    const store = new CredentialStore({
      path,
      protector: new FakeProtector(),
    });
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      protection: "test-protector",
      credentials: {},
      apiKey: "must-not-be-here",
    }), "utf8");
    await assert.rejects(store.load(), /未知字段/);

    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      protection: "test-protector",
      credentials: { DEEPSEEK_API_KEY: "not-valid-base64!" },
    }), "utf8");
    await assert.rejects(store.load(), /Base64/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("安全登录、状态和退出不显示 API Key", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemuse-auth-"));
  try {
    const store = new CredentialStore({
      path: join(root, "credentials.json"),
      protector: new FakeProtector(),
    });
    const env = {
      CODEMUSE_CONFIG_PATH: join(root, "missing-config.json"),
    };
    let output = "";
    const writer = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });

    assert.equal(await runAuthCommand(["login", "glm"], {
      env,
      store,
      readSecret: async () => "glm-secret",
      output: writer,
    }), 0);
    assert.equal((await store.load()).get("ZHIPUAI_API_KEY"), "glm-secret");

    assert.equal(await runAuthCommand(["status"], {
      env,
      store,
      output: writer,
    }), 0);
    assert.match(output, /glm.*已安全保存/);
    assert.match(output, /glm-flash.*已安全保存/);
    assert.doesNotMatch(output, /glm-secret/);

    assert.equal(await runAuthCommand(["logout", "glm-flash"], {
      env,
      store,
      output: writer,
    }), 0);
    assert.equal((await store.load()).has("ZHIPUAI_API_KEY"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("模型配置优先使用环境变量，其次使用持久凭据", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemuse-credential-profile-"));
  try {
    const configPath = join(root, "missing.json");
    const stored = await loadModelCatalog(
      { CODEMUSE_CONFIG_PATH: configPath },
      new Map([["DEEPSEEK_API_KEY", "stored-secret"]]),
    );
    const storedProfile = stored.profiles.find((profile) =>
      profile.name === "deepseek"
    );
    assert.equal(storedProfile?.credentialSource, "stored");
    assert.equal(storedProfile?.config?.apiKey, "stored-secret");

    const environment = await loadModelCatalog(
      {
        CODEMUSE_CONFIG_PATH: configPath,
        DEEPSEEK_API_KEY: "environment-secret",
      },
      new Map([["DEEPSEEK_API_KEY", "stored-secret"]]),
    );
    const environmentProfile = environment.profiles.find((profile) =>
      profile.name === "deepseek"
    );
    assert.equal(environmentProfile?.credentialSource, "environment");
    assert.equal(environmentProfile?.config?.apiKey, "environment-secret");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
