import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ProjectMemory,
  ProjectMemoryKind,
  ProjectMemorySource,
} from "../types.ts";
import { estimateTokens } from "../context/token-budget.ts";
import { WorkspaceDataFile } from "../workspace/data-file.ts";

const SCHEMA_VERSION = 1;
const MAX_MEMORIES = 200;
const MAX_MEMORY_TOKENS = 1_000;

type MemoryFile = {
  schemaVersion: 1;
  memories: ProjectMemory[];
};

export class ProjectMemoryStore {
  private readonly data: WorkspaceDataFile;
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.data = new WorkspaceDataFile(workspaceRoot, "memory.json");
  }

  async list(refresh = true): Promise<ProjectMemory[]> {
    const file = await this.loadFile();
    if (refresh) {
      let changed = false;
      for (const memory of file.memories) {
        const stale = await this.isStale(memory);
        if (stale !== memory.stale) {
          memory.stale = stale;
          memory.updatedAt = new Date().toISOString();
          changed = true;
        }
      }
      if (changed) await this.saveFile(file);
    }
    return structuredClone(file.memories);
  }

  async get(selector: string): Promise<ProjectMemory> {
    const memories = await this.list();
    const matches = memories.filter((memory) =>
      memory.id.toLowerCase().startsWith(selector.toLowerCase())
    );
    if (!matches.length) throw new Error(`没有找到记忆：${selector}`);
    if (matches.length > 1) throw new Error("记忆 ID 前缀不唯一");
    return matches[0];
  }

  async add(
    content: string,
    options: {
      kind?: ProjectMemoryKind;
      source?: ProjectMemorySource;
      relatedPaths?: string[];
      confidence?: number;
    } = {},
  ): Promise<ProjectMemory> {
    const normalized = content.replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length > 2_000) {
      throw new Error("记忆内容必须是 1—2000 个字符");
    }
    if (looksSensitive(normalized)) {
      throw new Error("记忆内容疑似包含密钥或敏感凭据，已拒绝保存");
    }
    const relatedPaths = [...new Set(options.relatedPaths ?? inferPaths(normalized))]
      .filter(isSafePath)
      .slice(0, 20);
    const invalidationKeys: Record<string, string> = {};
    for (const path of relatedPaths) {
      const fingerprint = await fingerprintFile(this.workspaceRoot, path);
      if (fingerprint) invalidationKeys[path] = fingerprint;
    }
    const now = new Date().toISOString();
    const memory: ProjectMemory = {
      id: randomUUID(),
      kind: options.kind ?? "decision",
      content: normalized,
      sources: [options.source ?? { type: "user", reference: "CLI /memory add" }],
      relatedPaths,
      confidence: clamp(options.confidence ?? 1, 0, 1),
      verifiedAt: now,
      stale: false,
      invalidationKeys,
      createdAt: now,
      updatedAt: now,
    };
    const file = await this.loadFile();
    file.memories.unshift(memory);
    file.memories = file.memories.slice(0, MAX_MEMORIES);
    await this.saveFile(file);
    return structuredClone(memory);
  }

  async forget(selector: string): Promise<boolean> {
    const file = await this.loadFile();
    const matches = file.memories.filter((memory) =>
      memory.id.toLowerCase().startsWith(selector.toLowerCase())
    );
    if (!matches.length) return false;
    if (matches.length > 1) throw new Error("记忆 ID 前缀不唯一");
    file.memories = file.memories.filter((memory) => memory.id !== matches[0].id);
    await this.saveFile(file);
    return true;
  }

  async clear(): Promise<void> {
    await this.data.remove();
  }

  async retrieve(task: string): Promise<string[]> {
    const terms = new Set(
      (task.toLowerCase().match(/[a-z_][a-z0-9_-]{1,}|[\p{Script=Han}]{2,8}/gu) ?? [])
        .map((term) => term.toLowerCase()),
    );
    const memories = (await this.list())
      .filter((memory) => !memory.stale)
      .map((memory) => ({
        memory,
        score: scoreMemory(memory, terms),
      }))
      .sort((left, right) =>
        right.score - left.score ||
        right.memory.updatedAt.localeCompare(left.memory.updatedAt)
      );
    const selected: string[] = [];
    let tokens = 0;
    for (const { memory } of memories) {
      const line = `[${memory.kind}] ${memory.content}（来源：${
        memory.sources.map((source) => source.reference).join("、")
      }）`;
      const lineTokens = estimateTokens(line);
      if (tokens + lineTokens > MAX_MEMORY_TOKENS) continue;
      selected.push(line);
      tokens += lineTokens;
      if (selected.length >= 8) break;
    }
    return selected;
  }

  private async isStale(memory: ProjectMemory): Promise<boolean> {
    for (const [path, expected] of Object.entries(memory.invalidationKeys)) {
      if (await fingerprintFile(this.workspaceRoot, path) !== expected) return true;
    }
    return false;
  }

  private async loadFile(): Promise<MemoryFile> {
    const value = await this.data.read();
    if (value === null) return { schemaVersion: 1, memories: [] };
    if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(`记忆文件 schemaVersion 必须是 ${SCHEMA_VERSION}`);
    }
    const extras = Object.keys(value).filter((key) =>
      !["schemaVersion", "memories"].includes(key)
    );
    if (extras.length) throw new Error(`记忆文件包含未知字段：${extras.join("、")}`);
    if (!Array.isArray(value.memories) || value.memories.length > MAX_MEMORIES) {
      throw new Error("记忆文件 memories 无效");
    }
    return {
      schemaVersion: 1,
      memories: value.memories.map(validateMemory),
    };
  }

  private saveFile(file: MemoryFile): Promise<void> {
    return this.data.write(file);
  }
}

function validateMemory(value: unknown): ProjectMemory {
  if (!isRecord(value)) throw new Error("记忆记录必须是对象");
  const kinds = [
    "architecture", "convention", "decision", "validation", "issue",
    "verified-result",
  ];
  if (
    typeof value.id !== "string" ||
    !kinds.includes(String(value.kind)) ||
    typeof value.content !== "string" ||
    value.content.length > 2_000 ||
    !Array.isArray(value.sources) ||
    !value.sources.every(isSource) ||
    !Array.isArray(value.relatedPaths) ||
    !value.relatedPaths.every(isSafePath) ||
    typeof value.confidence !== "number" ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    !isIsoDate(value.verifiedAt) ||
    typeof value.stale !== "boolean" ||
    !isRecord(value.invalidationKeys) ||
    !Object.entries(value.invalidationKeys).every(([path, fingerprint]) =>
      isSafePath(path) &&
      typeof fingerprint === "string" &&
      /^[0-9a-f]{64}$/i.test(fingerprint)
    ) ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.updatedAt)
  ) {
    throw new Error("记忆记录内容无效");
  }
  return structuredClone(value) as ProjectMemory;
}

function isSource(value: unknown): boolean {
  return isRecord(value) &&
    ["user", "tool", "session"].includes(String(value.type)) &&
    typeof value.reference === "string" &&
    value.reference.length <= 500;
}

function scoreMemory(memory: ProjectMemory, terms: Set<string>): number {
  const haystack = `${memory.content} ${memory.relatedPaths.join(" ")}`.toLowerCase();
  let score = memory.confidence * 10;
  for (const term of terms) if (haystack.includes(term)) score += 8;
  if (memory.kind === "decision" || memory.kind === "convention") score += 2;
  return score;
}

async function fingerprintFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<string | null> {
  try {
    const content = await readFile(join(workspaceRoot, ...relativePath.split("/")));
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

function inferPaths(content: string): string[] {
  return [...content.matchAll(
    /(?:^|[\s`"'(])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)(?=$|[\s`"',):])/g,
  )].flatMap((match) => match[1] ? [match[1]] : []);
}

function looksSensitive(value: string): boolean {
  return /\bsk-[A-Za-z0-9_-]{8,}\b|authorization\s*:\s*bearer|api[_ -]?key\s*[:=]/i
    .test(value);
}

function isSafePath(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    !value.startsWith("/") &&
    !value.includes("..") &&
    !value.includes("\\");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
