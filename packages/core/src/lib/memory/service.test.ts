/**
 * service.ts 单测 —— 日期缓存边界、scope 过滤、prompt 构造、priority 映射。
 *
 * 不依赖 DB；缓存测试使用进程内 Keyv，mem0 通过 mock 隔离。
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { getMemory } from "./mem0";
import {
  buildPreferencePrompt,
  buildProfilePrompt,
  buildProjectPrompt,
  defaultPriorityForScope,
  getMemories,
  invalidateMemoryCache,
  toMemoryDate,
  type UserMemory,
} from "./service";

vi.mock("./mem0", () => ({ getMemory: vi.fn() }));

function mem(overrides: Partial<UserMemory>): UserMemory {
  return {
    id: overrides.id ?? "m1",
    scope: overrides.scope ?? "preference",
    content: overrides.content ?? "content",
    source: overrides.source ?? "manual",
    disclosure: overrides.disclosure ?? null,
    priority: overrides.priority,
    lastAccessedAt: overrides.lastAccessedAt ?? null,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("memory date normalization", () => {
  it("兼容 Date、缓存字符串与无效值", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(toMemoryDate(date)).toBe(date);
    expect(toMemoryDate("2026-01-02T00:00:00.000Z")?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect(toMemoryDate("invalid")).toBeNull();
    expect(toMemoryDate(null)).toBeNull();
  });

  it("Keyv 缓存命中后仍返回 Date", async () => {
    const getAll = vi.fn().mockResolvedValue({
      results: [{ id: "m-cache", memory: "cached", metadata: {}, createdAt: "2026-01-03T00:00:00.000Z" }],
    });
    vi.mocked(getMemory).mockResolvedValue({ getAll, delete: vi.fn() } as never);

    await invalidateMemoryCache("cache-date-user");
    const first = await getMemories("cache-date-user");
    const cached = await getMemories("cache-date-user");

    expect(first[0].createdAt).toBeInstanceOf(Date);
    expect(cached[0].createdAt).toBeInstanceOf(Date);
    expect(cached[0].createdAt?.toISOString()).toBe("2026-01-03T00:00:00.000Z");
    expect(getAll).toHaveBeenCalledTimes(1);
    expect(getAll).toHaveBeenCalledWith({ filters: { user_id: "cache-date-user" }, showExpired: true });
    await invalidateMemoryCache("cache-date-user");
  });

  it("过滤过期项目记忆且清理失败不影响有效结果", async () => {
    const getAll = vi.fn().mockResolvedValue({
      results: [
        { id: "expired", memory: "旧项目", metadata: { scope: "project", expirationDate: "2000-01-01" } },
        { id: "active", memory: "当前项目", metadata: { scope: "project", expirationDate: "2999-01-01" } },
        { id: "profile", memory: "用户画像", metadata: { scope: "profile" } },
      ],
    });
    const remove = vi.fn().mockRejectedValue(new Error("mem0 unavailable"));
    vi.mocked(getMemory).mockResolvedValue({ getAll, delete: remove } as never);

    await invalidateMemoryCache("expired-memory-user");
    const memories = await getMemories("expired-memory-user");

    expect(memories.map((item) => item.id)).toEqual(["active", "profile"]);
    expect(remove).toHaveBeenCalledWith("expired");
    await invalidateMemoryCache("expired-memory-user");
  });
});

describe("defaultPriorityForScope", () => {
  it("preference → 0, profile → 1, project → 2", () => {
    expect(defaultPriorityForScope("preference")).toBe(0);
    expect(defaultPriorityForScope("profile")).toBe(1);
    expect(defaultPriorityForScope("project")).toBe(2);
  });
});

describe("buildPreferencePrompt", () => {
  it("只取 preference scope", () => {
    const memories = [
      mem({ scope: "preference", content: "用中文回复" }),
      mem({ scope: "profile", content: "工程师" }),
      mem({ scope: "project", content: "做项目A" }),
    ];
    expect(buildPreferencePrompt(memories)).toBe("用中文回复");
  });

  it("多条 preference 用分号连接", () => {
    const memories = [
      mem({ scope: "preference", content: "用中文回复" }),
      mem({ scope: "preference", content: "简洁回答" }),
    ];
    expect(buildPreferencePrompt(memories)).toBe("用中文回复; 简洁回答");
  });

  it("cap 400 字截断", () => {
    const long = "a".repeat(500);
    const memories = [mem({ scope: "preference", content: long })];
    expect(buildPreferencePrompt(memories).length).toBe(400);
  });

  it("无 preference 返回空串", () => {
    const memories = [mem({ scope: "profile", content: "工程师" })];
    expect(buildPreferencePrompt(memories)).toBe("");
  });
});

describe("buildProfilePrompt", () => {
  it("只取 profile scope(不含 project/preference)", () => {
    const memories = [
      mem({ scope: "preference", content: "用中文回复" }),
      mem({ scope: "profile", content: "前端工程师" }),
      mem({ scope: "project", content: "做项目A" }),
    ];
    expect(buildProfilePrompt(memories)).toBe("- 前端工程师");
  });

  it("限量 top N", () => {
    const memories = [
      mem({ id: "p1", scope: "profile", content: "前端工程师" }),
      mem({ id: "p2", scope: "profile", content: "会 TypeScript" }),
      mem({ id: "p3", scope: "profile", content: "在杭州" }),
    ];
    expect(buildProfilePrompt(memories, 2)).toBe("- 前端工程师\n- 会 TypeScript");
  });

  it("无 profile 返回空串", () => {
    const memories = [mem({ scope: "project", content: "做项目A" })];
    expect(buildProfilePrompt(memories)).toBe("");
  });
});

describe("buildProjectPrompt", () => {
  it("格式化为列表项", () => {
    const memories = [
      mem({ scope: "project", content: "正在开发 Nekosora" }),
      mem({ scope: "project", content: "用 Drizzle ORM" }),
    ];
    expect(buildProjectPrompt(memories)).toBe("- 正在开发 Nekosora\n- 用 Drizzle ORM");
  });

  it("限量 top N", () => {
    const memories = [
      mem({ scope: "project", content: "项目A" }),
      mem({ scope: "project", content: "项目B" }),
      mem({ scope: "project", content: "项目C" }),
    ];
    expect(buildProjectPrompt(memories, 2)).toBe("- 项目A\n- 项目B");
  });

  it("空数组返回空串", () => {
    expect(buildProjectPrompt([])).toBe("");
  });
});
