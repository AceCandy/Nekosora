/**
 * recall.ts 单测 -- mem0 召回路径验证(M-3)。
 *
 * 覆盖:
 *   - recallMemories 调 mem0.search(query, {filters:{user_id, scope:project}, topK})
 *   - 结果经 toUserMemory 转 UserMemory(metadata 缺省回退 project/manual)
 *   - mem0 抛错时静默返回空
 *   - 空结果返回空数组
 *
 * 通过 mock @/lib/memory/mem0(getMemory)+ 真实 toUserMemory(service)隔离。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

interface FakeMemoryItem {
  id: string;
  memory: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

const mockData = vi.hoisted(() => ({
  searchResults: [] as FakeMemoryItem[],
  shouldThrow: false,
  lastSearch: null as null | { query: string; config: unknown },
}));

vi.mock("@/lib/memory/mem0", () => ({
  getMemory: vi.fn(async () => ({
    search: vi.fn(async (query: string, config: unknown) => {
      mockData.lastSearch = { query, config };
      if (mockData.shouldThrow) throw new Error("mem0 down");
      return { results: mockData.searchResults };
    }),
  })),
  resetMemoryClient: vi.fn(),
}));

import { recallMemories } from "./recall";

beforeEach(() => {
  mockData.searchResults = [];
  mockData.shouldThrow = false;
  mockData.lastSearch = null;
});

describe("recallMemories", () => {
  it("调 mem0.search with scope=project filter + topK", async () => {
    mockData.searchResults = [
      { id: "m1", memory: "项目A", metadata: { scope: "project", source: "ai" } },
    ];
    const result = await recallMemories("u1", "查询", 5);

    expect(mockData.lastSearch).toEqual({
      query: "查询",
      config: { topK: 5, filters: { user_id: "u1", scope: "project" } },
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("m1");
    expect(result[0].content).toBe("项目A");
    expect(result[0].scope).toBe("project");
    expect(result[0].source).toBe("ai");
  });

  it("结果转 UserMemory(metadata 缺省回退 project/manual)", async () => {
    mockData.searchResults = [{ id: "m2", memory: "无元数据", metadata: {} }];
    const result = await recallMemories("u1", "查询");
    expect(result[0].scope).toBe("project"); // 缺省 project
    expect(result[0].source).toBe("manual"); // 缺省 manual
  });

  it("createdAt 字符串转 Date", async () => {
    mockData.searchResults = [
      { id: "m3", memory: "x", metadata: { scope: "project" }, createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    const result = await recallMemories("u1", "查询");
    expect(result[0].createdAt).toBeInstanceOf(Date);
  });

  it("mem0 抛错时静默返回空", async () => {
    mockData.shouldThrow = true;
    const result = await recallMemories("u1", "查询");
    expect(result).toEqual([]);
  });

  it("空结果返回空数组", async () => {
    mockData.searchResults = [];
    const result = await recallMemories("u1", "查询");
    expect(result).toEqual([]);
  });
});
