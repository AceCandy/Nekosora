import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  setKeyEnabled: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  or: vi.fn((...conditions: unknown[]) => ({ op: "or", conditions })),
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: mocks.and,
  or: mocks.or,
  ne: vi.fn(),
  asc: vi.fn(),
  sql: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));
vi.mock("@/lib/keys", () => ({
  createMasterKey: vi.fn(),
  createSubKey: vi.fn(),
  listKeys: vi.fn(),
  setKeyEnabled: mocks.setKeyEnabled,
}));

import { bindModel, disableKey, getBindings, unbindBinding } from "./actions";

const schema = {
  apiKeys: { id: "apiKeys.id", userId: "apiKeys.userId", kind: "apiKeys.kind" },
  keyModelBindings: { id: "bindings.id", keyId: "bindings.keyId" },
  models: {
    id: "models.id",
    enabled: "models.enabled",
    visibility: "models.visibility",
    ownerUserId: "models.ownerUserId",
  },
};

function selectReturning(rows: Record<string, unknown>[]) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    limit: vi.fn().mockResolvedValue(rows),
    then: (resolve: (value: Record<string, unknown>[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return query;
}

function makeDb(selectedRows: Record<string, unknown>[][]) {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values }));
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn(() => ({ where: deleteWhere }));
  return {
    db: {
      select: vi.fn(() => selectReturning(selectedRows.shift() ?? [])),
      insert,
      delete: remove,
    },
    values,
    insert,
    deleteWhere,
    remove,
  };
}

describe("子密钥模型绑定属主隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
  });

  it("不能禁用其他用户的 key", async () => {
    const { db } = makeDb([[]]);
    mocks.getDb.mockResolvedValue(db);

    await expect(disableKey("foreign-key")).rejects.toThrow("密钥不存在或无权操作");
    expect(mocks.setKeyEnabled).not.toHaveBeenCalled();
  });

  it("允许禁用自己的 key", async () => {
    const { db } = makeDb([[{ id: "own-key", kind: "sub" }]]);
    mocks.getDb.mockResolvedValue(db);

    await disableKey("own-key");

    expect(mocks.setKeyEnabled).toHaveBeenCalledWith("own-key", false);
  });

  it("不能读取其他用户 key 的绑定", async () => {
    const { db } = makeDb([[]]);
    mocks.getDb.mockResolvedValue(db);

    await expect(getBindings("foreign-key")).rejects.toThrow("密钥不存在或无权操作");
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("允许读取自己 key 的绑定", async () => {
    const bindings = [{ id: "binding-1", keyId: "own-key", modelId: "model-1" }];
    const { db } = makeDb([[{ id: "own-key", kind: "sub" }], bindings]);
    mocks.getDb.mockResolvedValue(db);

    await expect(getBindings("own-key")).resolves.toEqual(bindings);
  });

  it("不能给其他用户的 key 添加绑定", async () => {
    const { db, insert } = makeDb([[]]);
    mocks.getDb.mockResolvedValue(db);

    await expect(bindModel("foreign-key", "public-model")).rejects.toThrow("密钥不存在或无权操作");
    expect(insert).not.toHaveBeenCalled();
  });

  it("不能给 master key 添加绑定", async () => {
    const { db, insert } = makeDb([[{ id: "master-key", kind: "master" }]]);
    mocks.getDb.mockResolvedValue(db);

    await expect(bindModel("master-key", "public-model")).rejects.toThrow("密钥不存在或无权操作");
    expect(insert).not.toHaveBeenCalled();
  });

  it("不能绑定其他用户的 private 模型", async () => {
    const { db, insert } = makeDb([[{ id: "sub-key", kind: "sub" }], []]);
    mocks.getDb.mockResolvedValue(db);

    await expect(bindModel("sub-key", "foreign-private-model")).rejects.toThrow("模型不存在或无权操作");
    expect(mocks.or).toHaveBeenCalledWith(
      { op: "eq", left: schema.models.visibility, right: "public" },
      { op: "eq", left: schema.models.ownerUserId, right: "user-1" },
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ["public 模型", { id: "public-model", visibility: "public", ownerUserId: "user-2" }],
    ["自己的 private 模型", { id: "private-model", visibility: "private", ownerUserId: "user-1" }],
  ])("允许绑定%s", async (_name, model) => {
    const { db, values } = makeDb([[{ id: "sub-key", kind: "sub" }], [model]]);
    mocks.getDb.mockResolvedValue(db);

    await bindModel("sub-key", model.id);

    expect(values).toHaveBeenCalledWith({ keyId: "sub-key", modelId: model.id });
  });

  it("不能删除其他用户 key 的绑定", async () => {
    const { db, remove } = makeDb([[{ keyId: "foreign-key" }], []]);
    mocks.getDb.mockResolvedValue(db);

    await expect(unbindBinding("foreign-binding")).rejects.toThrow("密钥不存在或无权操作");
    expect(remove).not.toHaveBeenCalled();
  });
});
