/**
 * recall.ts 单测 —— 召回逻辑验证(design §3)。
 *
 * 覆盖:
 *   - 向量召回:融合向量命中(project scope only)
 *   - 关键词兜底:embedding 不可用时走分词匹配
 *   - 过期过滤:lastAccessedAt 超过 7 天不召回
 *   - 命中刷新 lastAccessedAt
 *   - findSimilarMemory 去重近邻检查
 *
 * 通过 mock DB(drizzle-orm + @/lib/infra/db)+ mock embedding 隔离真实依赖,
 * 测试 pg 向量召回路径(mock `<=>` 距离,由 distanceToSimilarity 还原为余弦相似度)。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- 共享 mock 状态(vi.hoisted 保证 vi.mock factory 可访问)----
const mockData = vi.hoisted(() => ({
  store: [] as Record<string, unknown>[],
  embedImpl: null as null | ((text: string) => Promise<number[]>),
}));

// ---- mock drizzle-orm:返回简单条件对象供 mock DB 解释 ----
vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ type: "eq", col, val }),
  and: (...conds: unknown[]) => ({ type: "and", conds }),
  inArray: (col: string, vals: unknown[]) => ({ type: "inArray", col, vals }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: "sql", strings: [...strings], values }),
}));

// ---- mock @/lib/infra/db:内存表 + 条件过滤 ----
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
      execute: async (sqlObj: { strings?: string[]; values?: unknown[] }) => {
        const strings = sqlObj.strings ?? [];
        const values = sqlObj.values ?? [];
        let text = "";
        for (let i = 0; i < strings.length; i++) {
          text += strings[i];
          if (i < values.length) text += String(values[i]);
        }
        // DELETE:project 过期清理
        if (text.includes("DELETE") && text.includes("project")) {
          const now = Date.now();
          for (let i = mockData.store.length - 1; i >= 0; i--) {
            const r = mockData.store[i];
            if (r.scope === "project" && r.lastAccessedAt) {
              if (now - (r.lastAccessedAt as Date).getTime() > 7 * 86400 * 1000) {
                mockData.store.splice(i, 1);
              }
            }
          }
          return { rows: [] };
        }
        // SELECT:pg 向量检索(<=> ),内存模拟(distanceToSimilarity 还原为原始余弦相似度)
        if (text.includes("<=>") || /distance/i.test(text)) {
          const embVal = values.find((v) => typeof v === "string" && /^\[[\d.,\s-]*\]$/.test(v));
          const q: number[] = embVal
            ? String(embVal).replace(/[\[\]]/g, "").split(",").map(Number)
            : [];
          let scope: string | null = null;
          for (const s of ["preference", "profile", "project"]) {
            if (text.includes(`scope = ${s}`) || text.includes(`scope = '${s}'`)) { scope = s; break; }
          }
          const checkRecent = /lastaccessedat\s*>/i.test(text);
          const now = Date.now();
          const distOf = (emb: unknown) => {
            const e = Array.isArray(emb) ? (emb as number[]) : typeof emb === "string" ? (JSON.parse(emb) as number[]) : [];
            const len = Math.min(e.length, q.length);
            let dot = 0, na = 0, nb = 0;
            for (let i = 0; i < len; i++) { dot += e[i] * q[i]; na += e[i] * e[i]; nb += q[i] * q[i]; }
            const cos = na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
            return 2 * (1 - cos); // distanceToSimilarity(此值) = cos,对齐原内存余弦语义
          };
          const rows = mockData.store.filter((r) => {
            if (!r.embedding) return false;
            if (scope && r.scope !== scope) return false;
            if (checkRecent && r.lastAccessedAt && now - (r.lastAccessedAt as Date).getTime() > 7 * 86400 * 1000) return false;
            return true;
          });
          rows.sort((a, b) => distOf(a.embedding) - distOf(b.embedding));
          const limitMatch = text.match(/LIMIT\s+(\d+)/i);
          const limit = limitMatch ? Number(limitMatch[1]) : rows.length;
          return {
            rows: rows.slice(0, limit).map((r) => ({
              id: r.id, scope: r.scope, content: r.content, source: r.source,
              disclosure: r.disclosure, distance: distOf(r.embedding),
            })),
          };
        }
        return { rows: [] };
      },
    }),
    getSchema: () => schema,
    isPg: false,
  };
});

// ---- mock embedding:可控向量 ----
vi.mock("@/lib/rag/embedding", () => ({
  embedText: vi.fn(async (text: string) => {
    if (mockData.embedImpl) return mockData.embedImpl(text);
    throw new Error("embedding not configured");
  }),
}));

// ---- mock cache:pass-through ----
vi.mock("@/lib/infra/cache", () => ({
  cacheWrap: vi.fn(async (_key: string, fetcher: () => Promise<unknown>) => fetcher()),
  cacheDel: vi.fn().mockResolvedValue(undefined),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));

import { recallMemories, findSimilarMemory } from "./recall";

beforeEach(() => {
  mockData.store = [];
  mockData.embedImpl = null;
});

function makeMemory(overrides: Partial<Record<string, unknown>> & { id: string }) {
  return {
    userId: "u1",
    scope: "project",
    content: "content",
    source: "ai",
    disclosure: null,
    priority: 2,
    embedding: null,
    lastAccessedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

describe("recallMemories", () => {
  it("向量召回:返回相似度达标的 project 记忆", async () => {
    mockData.store = [
      makeMemory({ id: "m1", content: "项目A", embedding: [1, 0, 0] }),
      makeMemory({ id: "m2", content: "项目B", embedding: [0, 1, 0] }),
    ];
    mockData.embedImpl = async (text) => {
      if (text.includes("项目A")) return [1, 0, 0];
      return [0, 0, 1];
    };

    const result = await recallMemories("u1", "关于项目A");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("m1");
  });

  it("只召回 project scope(preference/profile 不参与)", async () => {
    mockData.store = [
      makeMemory({ id: "m1", scope: "preference", content: "用中文", embedding: [1, 0, 0] }),
      makeMemory({ id: "m2", scope: "profile", content: "工程师", embedding: [1, 0, 0] }),
      makeMemory({ id: "m3", scope: "project", content: "项目A", embedding: [1, 0, 0] }),
    ];
    mockData.embedImpl = async () => [1, 0, 0];

    const result = await recallMemories("u1", "anything");
    expect(result).toHaveLength(1);
    expect(result[0].scope).toBe("project");
  });

  it("过期过滤:lastAccessedAt 超过 7 天的 project 不召回", async () => {
    const oldDate = new Date(Date.now() - 8 * 86400 * 1000);
    mockData.store = [
      makeMemory({ id: "m1", content: "旧项目", embedding: [1, 0, 0], lastAccessedAt: oldDate }),
      makeMemory({ id: "m2", content: "新项目", embedding: [1, 0, 0], lastAccessedAt: new Date() }),
    ];
    mockData.embedImpl = async () => [1, 0, 0];

    const result = await recallMemories("u1", "项目");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("m2");
  });

  it("关键词兜底:embedding 不可用时走关键词匹配", async () => {
    mockData.store = [
      makeMemory({ id: "m1", content: "正在开发 Nekosora 项目", embedding: null }),
      makeMemory({ id: "m2", content: "学习 Rust", embedding: null }),
    ];
    mockData.embedImpl = null; // embedText throws

    const result = await recallMemories("u1", "Nekosora");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("m1");
  });

  it("关键词兜底:向量无结果时也走关键词匹配", async () => {
    mockData.store = [
      makeMemory({ id: "m1", content: "正在开发 Nekosora", embedding: [0, 1, 0] }),
    ];
    // 向量不匹配(相似度 0)
    mockData.embedImpl = async () => [1, 0, 0];

    const result = await recallMemories("u1", "Nekosora");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("m1");
  });

  it("命中后刷新 lastAccessedAt", async () => {
    const oldDate = new Date(Date.now() - 1 * 86400 * 1000);
    mockData.store = [
      makeMemory({ id: "m1", content: "项目A", embedding: [1, 0, 0], lastAccessedAt: oldDate }),
    ];
    mockData.embedImpl = async () => [1, 0, 0];

    await recallMemories("u1", "项目");
    // refreshLastAccessed 是 fire-and-forget,等微任务刷新
    await new Promise((r) => setTimeout(r, 10));
    const updated = mockData.store[0];
    expect((updated.lastAccessedAt as Date).getTime()).toBeGreaterThan(oldDate.getTime());
  });

  it("无匹配时返回空数组", async () => {
    mockData.store = [
      makeMemory({ id: "m1", content: "项目A", embedding: [0, 1, 0] }),
    ];
    mockData.embedImpl = async () => [1, 0, 0];

    const result = await recallMemories("u1", "完全不相关");
    // 向量无结果 → 关键词兜底;"完全不相关" 分词后无命中
    expect(result).toHaveLength(0);
  });
});

describe("findSimilarMemory", () => {
  it("返回相似度最高的记忆(同 scope)", async () => {
    mockData.store = [
      makeMemory({ id: "m1", scope: "preference", content: "A", embedding: [1, 0, 0] }),
      makeMemory({ id: "m2", scope: "preference", content: "B", embedding: [0.9, 0.1, 0] }),
      makeMemory({ id: "m3", scope: "project", content: "C", embedding: [1, 0, 0] }),
    ];

    const result = await findSimilarMemory("u1", [1, 0, 0], "preference");
    expect(result?.id).toBe("m1"); // sim=1.0
  });

  it("低于阈值(0.85)返回 null", async () => {
    mockData.store = [
      makeMemory({ id: "m1", scope: "preference", content: "A", embedding: [0, 1, 0] }),
    ];

    const result = await findSimilarMemory("u1", [1, 0, 0], "preference");
    expect(result).toBeNull(); // sim=0.0 < 0.85
  });

  it("只在同 scope 内查找", async () => {
    mockData.store = [
      makeMemory({ id: "m1", scope: "project", content: "A", embedding: [1, 0, 0] }),
    ];

    const result = await findSimilarMemory("u1", [1, 0, 0], "preference");
    expect(result).toBeNull(); // 不同 scope 不匹配
  });

  it("embedding 为 null 的记忆不参与", async () => {
    mockData.store = [
      makeMemory({ id: "m1", scope: "preference", content: "A", embedding: null }),
    ];

    const result = await findSimilarMemory("u1", [1, 0, 0], "preference");
    expect(result).toBeNull();
  });
});
