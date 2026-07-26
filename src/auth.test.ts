import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn(() => ({ api: {} })),
  drizzleAdapter: vi.fn(() => ({ adapter: true })),
  admin: vi.fn(() => ({ plugin: "admin" })),
  getDb: vi.fn(),
}));

vi.mock("better-auth", () => ({ betterAuth: mocks.betterAuth }));
vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: mocks.drizzleAdapter }));
vi.mock("better-auth/plugins", () => ({ admin: mocks.admin }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb }));

describe("Better Auth user fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockResolvedValue({});
  });

  it("将用户状态声明为服务端只读字段", async () => {
    const { getAuth } = await import("@/auth");

    await getAuth();

    expect(mocks.betterAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        user: {
          additionalFields: {
            status: {
              type: "string",
              required: true,
              defaultValue: "active",
              input: false,
            },
          },
        },
      }),
    );
  });
});
