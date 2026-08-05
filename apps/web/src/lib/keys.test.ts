import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
}));

vi.mock("drizzle-orm", () => ({ eq: mocks.eq, and: mocks.and }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));

import { hashSecret } from "@/lib/infra/crypto";
import { setKeyEnabled, verifyKey } from "./keys";

const schema = {
  apiKeys: {
    id: "apiKeys.id",
    userId: "apiKeys.userId",
    keyPrefix: "apiKeys.keyPrefix",
    enabled: "apiKeys.enabled",
  },
  user: { id: "user.id", status: "user.status" },
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

describe("verifyKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchema.mockReturnValue(schema);
  });

  it("拒绝 disabled 用户的 enabled key 且不更新使用时间", async () => {
    const rawKey = "sk-disabled-owner";
    const joinedWhere = vi.fn().mockResolvedValue([]);
    const innerJoin = vi.fn(() => ({ where: joinedWhere }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    const update = vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    }));
    mocks.getDb.mockResolvedValue({ select, update });

    await expect(verifyKey(rawKey)).resolves.toBeNull();
    expect(innerJoin).toHaveBeenCalledWith(
      schema.user,
      { op: "eq", left: schema.apiKeys.userId, right: schema.user.id },
    );
    expect(joinedWhere).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        { op: "eq", left: schema.apiKeys.keyPrefix, right: `${rawKey.slice(0, 8)}…` },
        { op: "eq", left: schema.apiKeys.enabled, right: true },
        { op: "eq", left: schema.user.status, right: "active" },
      ],
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("active 用户的 enabled key 保持可用并更新使用时间", async () => {
    const rawKey = "sk-active-owner";
    const key = {
      id: "key-2",
      userId: "user-2",
      parentId: null,
      kind: "master" as const,
      name: "主密钥",
      keyHash: hashSecret(rawKey),
      keyPrefix: `${rawKey.slice(0, 8)}…`,
      enabled: true,
      lastUsedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const joinedWhere = vi.fn().mockResolvedValue([{ key }]);
    const innerJoin = vi.fn(() => ({ where: joinedWhere }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateFrom = vi.fn(() => ({ where: updateWhere }));
    const set = vi.fn(() => ({ from: updateFrom }));
    const update = vi.fn(() => ({ set }));
    mocks.getDb.mockResolvedValue({ select, update });

    await expect(verifyKey(rawKey)).resolves.toEqual({
      record: key,
      ctx: {
        userId: "user-2",
        apiKeyId: "key-2",
        keyKind: "master",
        source: "gateway",
      },
    });
    expect(set).toHaveBeenCalledWith({ lastUsedAt: expect.any(Date) });
    expect(updateFrom).toHaveBeenCalledWith(schema.user);
    expect(updateWhere).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        { op: "eq", left: schema.apiKeys.id, right: "key-2" },
        { op: "eq", left: schema.apiKeys.enabled, right: true },
        { op: "eq", left: schema.apiKeys.userId, right: schema.user.id },
        { op: "eq", left: schema.user.status, right: "active" },
      ],
    });
  });
});
