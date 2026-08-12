import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  or: vi.fn((...conditions: unknown[]) => ({ op: "or", conditions })),
}));

vi.mock("drizzle-orm", () => ({ eq: mocks.eq, and: mocks.and, or: mocks.or }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));

import { hashSecret } from "@/lib/infra/crypto";
import { createMasterKey, createSubKey, listKeys, setKeyEnabled, verifyKey } from "./keys";

const schema = {
  apiKeys: {
    id: "apiKeys.id",
    userId: "apiKeys.userId",
    kind: "apiKeys.kind",
    name: "apiKeys.name",
    keyHash: "apiKeys.keyHash",
    keyPrefix: "apiKeys.keyPrefix",
    enabled: "apiKeys.enabled",
    lastUsedAt: "apiKeys.lastUsedAt",
  },
  user: { id: "user.id", status: "user.status" },
};

describe("createMasterKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchema.mockReturnValue(schema);
  });

  it("将已撤销的主密钥原位轮换为全新密钥", async () => {
    const existingMaster = {
      id: "master-1",
      userId: "user-1",
      kind: "master" as const,
      enabled: false,
      keyHash: hashSecret("sk-old-master-key"),
      keyPrefix: "sk-old-m…",
    };
    const selectWhere = vi.fn().mockResolvedValue([existingMaster]);
    const select = vi.fn(() => ({
      from: vi.fn(() => ({ where: selectWhere })),
    }));
    const returning = vi.fn().mockResolvedValue([{ id: existingMaster.id }]);
    const updateWhere = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set }));
    mocks.getDb.mockResolvedValue({ select, update });

    const rawKey = await createMasterKey("user-1");

    expect(rawKey).not.toBe("sk-old-master-key");
    expect(set).toHaveBeenCalledWith({
      keyHash: hashSecret(rawKey),
      keyPrefix: `${rawKey.slice(0, 8)}****${rawKey.slice(-4)}`,
      enabled: true,
      lastUsedAt: null,
    });
    expect(updateWhere).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        { op: "eq", left: schema.apiKeys.id, right: "master-1" },
        { op: "eq", left: schema.apiKeys.userId, right: "user-1" },
        { op: "eq", left: schema.apiKeys.kind, right: "master" },
        { op: "eq", left: schema.apiKeys.enabled, right: false },
      ],
    });
  });

  it("已有有效主密钥时拒绝生成", async () => {
    const selectWhere = vi.fn().mockResolvedValue([{
      id: "master-1",
      userId: "user-1",
      kind: "master",
      enabled: true,
    }]);
    const select = vi.fn(() => ({
      from: vi.fn(() => ({ where: selectWhere })),
    }));
    const update = vi.fn();
    const insert = vi.fn();
    mocks.getDb.mockResolvedValue({ select, update, insert });

    await expect(createMasterKey("user-1")).rejects.toThrow("该用户已存在主密钥");
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("轮换并发失败时不返回未落库的明文", async () => {
    const selectWhere = vi.fn().mockResolvedValue([{
      id: "master-1",
      userId: "user-1",
      kind: "master",
      enabled: false,
    }]);
    const select = vi.fn(() => ({
      from: vi.fn(() => ({ where: selectWhere })),
    }));
    const returning = vi.fn().mockResolvedValue([]);
    const update = vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(() => ({ returning })) })),
    }));
    mocks.getDb.mockResolvedValue({ select, update });

    await expect(createMasterKey("user-1")).rejects.toThrow("该用户已存在主密钥");
  });
});

describe("createSubKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchema.mockReturnValue(schema);
  });

  it("没有有效主密钥时拒绝创建子密钥", async () => {
    const selectWhere = vi.fn().mockResolvedValue([{
      id: "master-1",
      userId: "user-1",
      kind: "master",
      enabled: false,
    }]);
    const select = vi.fn(() => ({
      from: vi.fn(() => ({ where: selectWhere })),
    }));
    const insert = vi.fn();
    mocks.getDb.mockResolvedValue({ select, insert });

    await expect(createSubKey("user-1", "测试子密钥"))
      .rejects.toThrow("用户尚无主密钥,无法创建子密钥");
    expect(insert).not.toHaveBeenCalled();
  });

  it("新子密钥只持久化前后脱敏预览", async () => {
    const selectWhere = vi.fn().mockResolvedValue([{
      id: "master-1",
      userId: "user-1",
      kind: "master",
      enabled: true,
    }]);
    const select = vi.fn(() => ({
      from: vi.fn(() => ({ where: selectWhere })),
    }));
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values }));
    mocks.getDb.mockResolvedValue({ select, insert });

    const rawKey = await createSubKey("user-1", "测试子密钥");

    expect(values).toHaveBeenCalledWith({
      userId: "user-1",
      kind: "sub",
      name: "测试子密钥",
      keyHash: hashSecret(rawKey),
      keyPrefix: `${rawKey.slice(0, 8)}****${rawKey.slice(-4)}`,
      enabled: true,
    });
  });
});

describe("listKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchema.mockReturnValue(schema);
  });

  it("只查询并返回客户端展示字段", async () => {
    const storedRow = {
      id: "key-1",
      userId: "user-1",
      parentId: "master-1",
      kind: "sub" as const,
      name: "测试子密钥",
      keyHash: "secret-hash",
      keyPrefix: "sk-test-****abcd",
      enabled: true,
      lastUsedAt: new Date("2026-01-02T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const where = vi.fn();
    const from = vi.fn();
    const select = vi.fn((projection?: Record<string, string>) => {
      const row = projection
        ? Object.fromEntries(Object.keys(projection).map((key) => [key, storedRow[key as keyof typeof storedRow]]))
        : storedRow;
      where.mockResolvedValue([row]);
      from.mockReturnValue({ where });
      return { from };
    });
    mocks.getDb.mockResolvedValue({ select });

    const rows = await listKeys("user-1");

    expect(select).toHaveBeenCalledWith({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      keyPrefix: schema.apiKeys.keyPrefix,
      kind: schema.apiKeys.kind,
      enabled: schema.apiKeys.enabled,
    });
    expect(rows).toEqual([{
      id: "key-1",
      name: "测试子密钥",
      keyPrefix: "sk-test-****abcd",
      kind: "sub",
      enabled: true,
    }]);
    expect(JSON.stringify(rows)).not.toContain("keyHash");
    expect(JSON.stringify(rows)).not.toContain("parentId");
  });
});

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
        {
          op: "or",
          conditions: [
            { op: "eq", left: schema.apiKeys.keyPrefix, right: `${rawKey.slice(0, 8)}…` },
            { op: "eq", left: schema.apiKeys.keyPrefix, right: `${rawKey.slice(0, 8)}****${rawKey.slice(-4)}` },
          ],
        },
        { op: "eq", left: schema.apiKeys.enabled, right: true },
        { op: "eq", left: schema.user.status, right: "active" },
      ],
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("旧前缀格式的 active 用户 key 保持可用并更新使用时间", async () => {
    const rawKey = "sk-active-owner";
    const key = {
      id: "key-2",
      userId: "user-2",
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
    expect(joinedWhere).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        {
          op: "or",
          conditions: [
            { op: "eq", left: schema.apiKeys.keyPrefix, right: `${rawKey.slice(0, 8)}…` },
            { op: "eq", left: schema.apiKeys.keyPrefix, right: `${rawKey.slice(0, 8)}****${rawKey.slice(-4)}` },
          ],
        },
        { op: "eq", left: schema.apiKeys.enabled, right: true },
        { op: "eq", left: schema.user.status, right: "active" },
      ],
    });
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

  it("当前预览格式的 active 用户 key 保持可用", async () => {
    const rawKey = "sk-current-owner";
    const key = {
      id: "key-3",
      userId: "user-3",
      kind: "sub" as const,
      name: "子密钥",
      keyHash: hashSecret(rawKey),
      keyPrefix: `${rawKey.slice(0, 8)}****${rawKey.slice(-4)}`,
      enabled: true,
      lastUsedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const joinedWhere = vi.fn().mockResolvedValue([{ key }]);
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({ where: joinedWhere })),
      })),
    }));
    const update = vi.fn(() => ({
      set: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      })),
    }));
    mocks.getDb.mockResolvedValue({ select, update });

    await expect(verifyKey(rawKey)).resolves.toMatchObject({
      record: key,
      ctx: {
        userId: "user-3",
        apiKeyId: "key-3",
        keyKind: "sub",
        source: "gateway",
      },
    });
  });
});
