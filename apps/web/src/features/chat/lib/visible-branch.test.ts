import { describe, expect, it } from "vitest";
import { resolveVisibleBranch } from "./visible-branch";

const messages = [
  { id: "u1", publicId: "u1-public", parentId: null, role: "user", createdAt: new Date("2026-01-01T00:00:00Z") },
  { id: "a1", publicId: "a1-public", parentId: "u1", role: "assistant", content: "old", createdAt: new Date("2026-01-01T00:01:00Z") },
  { id: "a2", publicId: "a2-public", parentId: "u1", role: "assistant", content: "new", createdAt: new Date("2026-01-01T00:02:00Z") },
  { id: "u2", publicId: "u2-public", parentId: "a2", role: "user", createdAt: new Date("2026-01-01T00:03:00Z") },
] satisfies Record<string, unknown>[];

describe("resolveVisibleBranch", () => {
  it("默认沿最新叶子返回主线", () => {
    const result = resolveVisibleBranch(messages, null);
    expect(result.messages.map((message) => message.publicId)).toEqual(["u1-public", "a2-public", "u2-public"]);
    expect(result.versionMap.a2).toEqual({ current: 2, total: 2 });
  });

  it("以持久化选择替换同一兄弟组的 assistant", () => {
    const result = resolveVisibleBranch(messages, { u1: "a1-public" });
    expect(result.messages.map((message) => message.publicId)).toEqual(["u1-public", "a1-public", "u2-public"]);
    expect(result.versionMap.a1).toEqual({ current: 1, total: 2 });
  });

  it("陈旧选择回退当前主线版本", () => {
    const result = resolveVisibleBranch(messages, { u1: "deleted-public-id" });
    expect(result.messages.map((message) => message.publicId)).toEqual(["u1-public", "a2-public", "u2-public"]);
  });
});
