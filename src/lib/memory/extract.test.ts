/**
 * extract.ts 单测 -- mem0 抽取路径验证(M-3)。
 *
 * 覆盖:
 *   - 正常:extractMemories 调 mem0.add(messages, {userId, metadata:{scope:project,source:ai}})
 *   - 消息少于 2 条跳过
 *   - 频率保护:10 分钟内不重复提取
 *   - 核心失败传播通用错误供 worker 重试
 *
 * 通过 mock @/lib/memory/mem0(getMemory)+ mock @/lib/memory/service(invalidateMemoryCache)
 * + mock cache 隔离真实依赖。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockData = vi.hoisted(() => ({
  addCalls: [] as unknown[],
  addImpl: null as null | (() => Promise<unknown>),
  cacheStore: new Map<string, unknown>(),
}));

// mock @/lib/memory/mem0:getMemory 返回受控 memory 实例(add 记录调用)
vi.mock("@/lib/memory/mem0", () => ({
  getMemory: vi.fn(async () => ({
    add: vi.fn(async (messages: unknown, config: unknown) => {
      mockData.addCalls.push({ messages, config });
      if (mockData.addImpl) return mockData.addImpl();
      return { results: [] };
    }),
  })),
  resetMemoryClient: vi.fn(),
}));

// mock @/lib/memory/service:invalidateMemoryCache + toProjectExpirationDate(固定日期便于断言)
vi.mock("@/lib/memory/service", () => ({
  invalidateMemoryCache: vi.fn().mockResolvedValue(undefined),
  toProjectExpirationDate: vi.fn(() => "2026-01-08"),
}));

// mock cache:cacheWrap 首次缓存 fetcher 结果,cacheSet 覆盖(对齐真实 cacheWrap 语义)
vi.mock("@/lib/infra/cache", () => ({
  cacheWrap: vi.fn(async (key: string, fetcher: () => Promise<unknown>, _ttl?: number) => {
    if (mockData.cacheStore.has(key)) return mockData.cacheStore.get(key);
    const v = await fetcher();
    mockData.cacheStore.set(key, v);
    return v;
  }),
  cacheSet: vi.fn(async (key: string, value: unknown, _ttl?: number) => {
    mockData.cacheStore.set(key, value);
  }),
  cacheDel: vi.fn().mockResolvedValue(undefined),
}));

import { extractMemories, normalizeMemoryMessages } from "./extract";

beforeEach(() => {
  mockData.addCalls = [];
  mockData.addImpl = null;
  mockData.cacheStore.clear();
});

const TURNS = [
  { role: "user", content: "你好" },
  { role: "assistant", content: "你好,有什么可以帮你的?" },
];

describe("extractMemories", () => {
  it("正常:调 mem0.add with scope=project, source=ai", async () => {
    await extractMemories("u1", "conv1", TURNS);

    expect(mockData.addCalls).toHaveLength(1);
    const { messages, config } = mockData.addCalls[0] as {
      messages: { role: string; content: string }[];
      config: { userId: string; metadata: Record<string, unknown> };
    };
    expect(config).toEqual({
      userId: "u1",
      expirationDate: "2026-01-08",
      metadata: { scope: "project", source: "ai", expirationDate: "2026-01-08" },
    });
    expect(messages).toEqual([
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好,有什么可以帮你的?" },
    ]);
  });

  it("消息少于 2 条跳过(不调 add)", async () => {
    await extractMemories("u1", "conv1", [{ role: "user", content: "only one" }]);
    expect(mockData.addCalls).toHaveLength(0);
  });

  it("频率保护:10 分钟内不重复提取", async () => {
    await extractMemories("u1", "conv1", TURNS);
    await extractMemories("u1", "conv1", TURNS); // 第二次应被 cache 拦截
    expect(mockData.addCalls).toHaveLength(1);
  });

  it("mem0.add 失败时传播不含上游详情的通用错误", async () => {
    mockData.addImpl = async () => {
      throw new Error("mem0 down");
    };
    await expect(extractMemories("u1", "conv1", TURNS)).rejects.toMatchObject({
      name: "MemoryExtractionError",
      message: "记忆提取失败",
    });
  });

  it("持久化前只保留最后 6 条并规范 role/content 长度", () => {
    const normalized = normalizeMemoryMessages([
      { role: "system", content: "ignored role" },
      ...Array.from({ length: 6 }, (_, index) => ({
        role: index % 2 === 0 ? "assistant" : "tool",
        content: index === 5 ? "x".repeat(600) : String(index),
      })),
    ]);

    expect(normalized).toHaveLength(6);
    expect(normalized[0]).toEqual({ role: "assistant", content: "0" });
    expect(normalized[1]).toEqual({ role: "user", content: "1" });
    expect(normalized[5]?.content).toHaveLength(500);
  });
});
