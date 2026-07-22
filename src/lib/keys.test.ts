import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
}));

vi.mock("drizzle-orm", () => ({ eq: mocks.eq, and: mocks.and }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));

import { setKeyEnabled } from "./keys";

const schema = {
  apiKeys: { id: "apiKeys.id", userId: "apiKeys.userId" },
};

describe("setKeyEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchema.mockReturnValue(schema);
  });

  it("更新条件同时限制 key ID 与用户 ID", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    mocks.getDb.mockResolvedValue({ update });

    await setKeyEnabled("user-1", "key-1", false);

    expect(update).toHaveBeenCalledWith(schema.apiKeys);
    expect(set).toHaveBeenCalledWith({ enabled: false });
    expect(where).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        { op: "eq", left: schema.apiKeys.id, right: "key-1" },
        { op: "eq", left: schema.apiKeys.userId, right: "user-1" },
      ],
    });
  });
});
