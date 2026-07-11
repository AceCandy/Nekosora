/**
 * extract.ts 单测 —— 抽取逻辑验证(design §2)。
 *
 * 覆盖:
 *   - parseExtracted:解析 content/disclosure/scope/priority/confidence + 容错
 *   - 去重覆盖:explicit 覆盖 / weak 丢弃 / project 直接覆盖
 *   - 过期清理:purgeExpiredProjectMemories 入口触发
 *
 * 通过 mock DB + mock streamChat + mock embedding 隔离真实依赖。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- 共享 mock 状态 ----
const mockData = vi.hoisted(() => ({
  store: [] as Record<string, unknown>[],
  embedImpl: null as null | ((text: string) => Promise<number[]>),
  llmResponse: "[]" as string,
}));

// ---- mock drizzle-orm ----
vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ type: "eq", col, val }),
  and: (...conds: unknown[]) => ({ type: "and", conds }),
  inArray: (col: string, vals: unknown[]) => ({ type: "inArray", col, vals }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: "sql", strings: [...strings], values }),
}));

// ---- mock @/lib/infra/db ----
vi.mock("@/lib/infra/db", () => {
  function matches(row: Record<string, unknown>, cond: unknown): boolean {
    if (!cond) return true;
    const c = cond as { type: string; col?: string; val?: unknown; conds?: unknown[]; vals?: unknown[] };
    if (c.type === "eq") return row[c.col!] === c.val;
    if (c.type === "and") return c.conds!.every((sub) => matches(row, sub));
    if (c.type === "inArray") return c.vals!.includes(row[c.col!]);
    return true;
  }

  const schema = {
    userMemories: {
      id: "id",
      userId: "userId",
      scope: "scope",
      content: "content",
      source: "source",
      disclosure: "disclosure",
      priority: "priority",
      embedding: "embedding",
      lastAccessedAt: "lastAccessedAt",
      createdAt: "createdAt",
    },
  };

  return {
    getDb: async () => ({
      select: () => ({
        from: () => ({
          where: async (cond: unknown) => mockData.store.filter((r) => matches(r, cond)),
        }),
      }),
      update: () => ({
        set: (data: Record<string, unknown>) => ({
          where: async (cond: unknown) => {
            mockData.store.forEach((r) => {
              if (matches(r, cond)) Object.assign(r, data);
            });
          },
        }),
      }),
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          mockData.store.push({ ...row, id: row.id ?? `m${mockData.store.length + 1}`, createdAt: new Date() });
        },
      }),
      delete: () => ({
        where: async (cond: unknown) => {
          for (let i = mockData.store.length - 1; i >= 0; i--) {
            if (matches(mockData.store[i], cond)) mockData.store.splice(i, 1);
          }
        },
      }),
      execute: async (sqlObj: { strings?: string[] }) => {
        const sqlText = sqlObj.strings?.join("") ?? "";
        if (sqlText.includes("DELETE") && sqlText.includes("project")) {
          const now = Date.now();
          for (let i = mockData.store.length - 1; i >= 0; i--) {
            const r = mockData.store[i];
            if (r.scope === "project" && r.lastAccessedAt) {
              if (now - (r.lastAccessedAt as Date).getTime() > 7 * 86400 * 1000) {
                mockData.store.splice(i, 1);
              }
            }
          }
        }
        return { rows: [] };
      },
    }),
    getSchema: () => schema,
    isPg: false,
  };
});

// ---- mock embedding ----
vi.mock("@/lib/rag/embedding", () => ({
  embedText: vi.fn(async (text: string) => {
    if (mockData.embedImpl) return mockData.embedImpl(text);
    throw new Error("embedding not configured");
  }),
}));

// ---- mock cache ----
vi.mock("@/lib/infra/cache", () => ({
  cacheWrap: vi.fn(async (_key: string, fetcher: () => Promise<unknown>) => fetcher()),
  cacheDel: vi.fn().mockResolvedValue(undefined),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));

// ---- mock streamChat:返回配置好的 LLM 响应 ----
vi.mock("@/lib/stream", () => ({
  streamChat: vi.fn(async function* () {
    yield { type: "text-delta", text: mockData.llmResponse };
  }),
}));

import { parseExtracted, extractMemories } from "./extract";
import { purgeExpiredProjectMemories } from "./service";

beforeEach(() => {
  mockData.store = [];
  mockData.embedImpl = null;
  mockData.llmResponse = "[]";
});

function makeMemory(overrides: Partial<Record<string, unknown>> & { id: string }) {
  return {
    userId: "u1",
    scope: "preference",
    content: "content",
    source: "ai",
    disclosure: null,
    priority: 0,
    embedding: null,
    lastAccessedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

const TURNS = [
  { role: "user", content: "你好" },
  { role: "assistant", content: "你好,有什么可以帮你的?" },
];

describe("parseExtracted", () => {
  it("解析 content/disclosure/scope/priority/confidence", () => {
    const raw = JSON.stringify([
      {
        content: "喜欢中文回复",
        disclosure: "讨论语言时",
        scope: "preference",
        priority: 1,
        confidence: "explicit",
      },
    ]);
    const result = parseExtracted(raw);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("喜欢中文回复");
    expect(result[0].disclosure).toBe("讨论语言时");
    expect(result[0].scope).toBe("preference");
    expect(result[0].priority).toBe(1);
    expect(result[0].confidence).toBe("explicit");
  });

  it("无效 scope 默认 project", () => {
    const raw = JSON.stringify([{ content: "test", scope: "invalid" }]);
    const result = parseExtracted(raw);
    expect(result[0].scope).toBe("project");
  });

  it("无效 confidence 默认 weak", () => {
    const raw = JSON.stringify([{ content: "test", confidence: "maybe" }]);
    const result = parseExtracted(raw);
    expect(result[0].confidence).toBe("weak");
  });

  it("priority 未给时按 scope 默认", () => {
    const raw = JSON.stringify([{ content: "test", scope: "profile" }]);
    const result = parseExtracted(raw);
    expect(result[0].priority).toBe(1); // profile default
  });

  it("content 截断 500 字", () => {
    const long = "a".repeat(600);
    const raw = JSON.stringify([{ content: long }]);
    const result = parseExtracted(raw);
    expect(result[0].content.length).toBe(500);
  });

  it("空数组返回 []", () => {
    expect(parseExtracted("[]")).toEqual([]);
  });

  it("非 JSON 返回 []", () => {
    expect(parseExtracted("not json")).toEqual([]);
  });

  it("无 content 的项被过滤", () => {
    const raw = JSON.stringify([{ scope: "preference" }, { content: "valid" }]);
    const result = parseExtracted(raw);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("valid");
  });
});

describe("extractMemories 去重", () => {
  it("preference + explicit:覆盖已有相似记忆", async () => {
    mockData.store = [
      makeMemory({ id: "existing", scope: "preference", content: "喜欢中文回复", embedding: [1, 0, 0] }),
    ];
    mockData.llmResponse = JSON.stringify([
      {
        content: "偏好用中文回复",
        disclosure: "讨论语言时",
        scope: "preference",
        confidence: "explicit",
      },
    ]);
    mockData.embedImpl = async () => [1, 0, 0]; // sim=1.0 >= 0.85

    await extractMemories("u1", "conv1", TURNS, "test-model");

    expect(mockData.store).toHaveLength(1); // 覆盖,不是新增
    expect(mockData.store[0].content).toBe("偏好用中文回复");
    expect(mockData.store[0].disclosure).toBe("讨论语言时");
  });

  it("preference + weak:丢弃(不覆盖,不新增)", async () => {
    const originalContent = "喜欢中文回复";
    mockData.store = [
      makeMemory({ id: "existing", scope: "preference", content: originalContent, embedding: [1, 0, 0] }),
    ];
    mockData.llmResponse = JSON.stringify([
      {
        content: "也许偏好中文",
        disclosure: "讨论语言时",
        scope: "preference",
        confidence: "weak",
      },
    ]);
    mockData.embedImpl = async () => [1, 0, 0]; // sim=1.0 >= 0.85

    await extractMemories("u1", "conv1", TURNS, "test-model");

    expect(mockData.store).toHaveLength(1); // 未新增
    expect(mockData.store[0].content).toBe(originalContent); // 未覆盖
  });

  it("project:无论 confidence 都覆盖", async () => {
    mockData.store = [
      makeMemory({ id: "existing", scope: "project", content: "做项目A", embedding: [1, 0, 0], priority: 2 }),
    ];
    mockData.llmResponse = JSON.stringify([
      {
        content: "项目A进行中",
        disclosure: "讨论项目时",
        scope: "project",
        confidence: "weak", // 即使 weak 也覆盖
      },
    ]);
    mockData.embedImpl = async () => [1, 0, 0];

    await extractMemories("u1", "conv1", TURNS, "test-model");

    expect(mockData.store).toHaveLength(1);
    expect(mockData.store[0].content).toBe("项目A进行中");
  });

  it("无相似记忆时 insert 新记忆", async () => {
    mockData.store = [
      makeMemory({ id: "existing", scope: "preference", content: "喜欢中文", embedding: [1, 0, 0] }),
    ];
    mockData.llmResponse = JSON.stringify([
      {
        content: "正在学Rust",
        disclosure: "讨论编程语言时",
        scope: "project",
        confidence: "explicit",
      },
    ]);
    // 新记忆 scope=project,现有 scope=preference → findSimilarMemory 只查 project → null
    mockData.embedImpl = async () => [0, 1, 0];

    await extractMemories("u1", "conv1", TURNS, "test-model");

    expect(mockData.store).toHaveLength(2); // 新增
    const inserted = mockData.store.find((m) => m.scope === "project");
    expect(inserted).toBeDefined();
    expect(inserted?.content).toBe("正在学Rust");
    expect(inserted?.disclosure).toBe("讨论编程语言时");
    expect(inserted?.source).toBe("ai");
  });

  it("embedding 失败时跳过去重直接 insert", async () => {
    mockData.store = [];
    mockData.llmResponse = JSON.stringify([
      {
        content: "测试记忆",
        disclosure: "测试时",
        scope: "project",
        confidence: "explicit",
      },
    ]);
    mockData.embedImpl = null; // embedText throws

    await extractMemories("u1", "conv1", TURNS, "test-model");

    expect(mockData.store).toHaveLength(1);
    expect(mockData.store[0].embedding).toBeNull(); // embedding 失败置空
  });
});

describe("purgeExpiredProjectMemories", () => {
  it("删除超过 7 天未访问的 project 记忆", async () => {
    const oldDate = new Date(Date.now() - 8 * 86400 * 1000);
    const recentDate = new Date();
    mockData.store = [
      makeMemory({ id: "old", scope: "project", content: "旧项目", lastAccessedAt: oldDate }),
      makeMemory({ id: "new", scope: "project", content: "新项目", lastAccessedAt: recentDate }),
      makeMemory({ id: "pref", scope: "preference", content: "偏好", lastAccessedAt: oldDate }),
    ];

    await purgeExpiredProjectMemories("u1");

    expect(mockData.store).toHaveLength(2);
    expect(mockData.store.find((m) => m.id === "old")).toBeUndefined();
    expect(mockData.store.find((m) => m.id === "new")).toBeDefined();
    expect(mockData.store.find((m) => m.id === "pref")).toBeDefined(); // preference 不受影响
  });

  it("extractMemories 入口触发过期清理", async () => {
    const oldDate = new Date(Date.now() - 8 * 86400 * 1000);
    mockData.store = [
      makeMemory({ id: "expired", scope: "project", content: "过期项目", lastAccessedAt: oldDate }),
    ];
    mockData.llmResponse = "[]"; // LLM 返回空,不提取任何记忆

    await extractMemories("u1", "conv1", TURNS, "test-model");

    expect(mockData.store).toHaveLength(0); // 过期记忆被清理
  });
});
