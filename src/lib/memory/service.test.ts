/**
 * service.ts 纯函数单测 —— scope 过滤、prompt 构造、priority 映射。
 *
 * 不依赖 DB/cache,测试 buildPreferencePrompt / buildProfilePrompt / buildProjectPrompt
 * / defaultPriorityForScope 的纯逻辑。
 */
import { describe, it, expect } from "vitest";
import {
  buildPreferencePrompt,
  buildProfilePrompt,
  buildProjectPrompt,
  defaultPriorityForScope,
  type UserMemory,
} from "./service";

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
