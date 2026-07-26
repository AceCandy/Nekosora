import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  getAuth: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/auth", () => ({ getAuth: mocks.getAuth }));

import { getSession } from "./session";

describe("getSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuth.mockResolvedValue({ api: { getSession: mocks.getSession } });
  });

  it("权威读取并返回 active 用户", async () => {
    const requestHeaders = new Headers({ cookie: "session=token" });
    mocks.headers.mockResolvedValue(requestHeaders);
    mocks.getSession.mockResolvedValue({
      user: {
        id: "user-1",
        email: "active@example.com",
        name: "Active User",
        role: "admin",
        status: "active",
      },
    });

    await expect(getSession()).resolves.toEqual({
      id: "user-1",
      email: "active@example.com",
      name: "Active User",
      role: "admin",
      status: "active",
    });
    expect(mocks.getSession).toHaveBeenCalledWith({
      headers: requestHeaders,
      query: { disableCookieCache: true },
    });
  });

  it.each([
    ["disabled", "disabled"],
    ["缺失", undefined],
    ["未知", "suspended"],
  ])("拒绝%s状态的用户", async (_label, status) => {
    mocks.headers.mockResolvedValue(new Headers());
    mocks.getSession.mockResolvedValue({
      user: {
        id: "user-1",
        email: "blocked@example.com",
        name: "Blocked User",
        role: "user",
        status,
      },
    });

    await expect(getSession()).resolves.toBeNull();
  });

  it("权威会话读取失败时返回未授权", async () => {
    mocks.headers.mockResolvedValue(new Headers());
    mocks.getSession.mockRejectedValue(new Error("session backend unavailable"));

    await expect(getSession()).resolves.toBeNull();
  });
});
