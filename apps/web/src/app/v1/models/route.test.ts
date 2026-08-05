import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  extractBearer: vi.fn(),
  verifyKey: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
}));

vi.mock("drizzle-orm", () => ({ eq: mocks.eq, and: mocks.and }));
vi.mock("@/lib/keys", () => ({
  extractBearer: mocks.extractBearer,
  verifyKey: mocks.verifyKey,
}));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));

import { GET } from "./route";

const schema = {
  keyModelBindings: { keyId: "bindings.keyId" },
  models: {
    id: "models.id",
    ownerUserId: "models.ownerUserId",
    enabled: "models.enabled",
  },
};

function queryReturning(rows: Record<string, unknown>[]) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    limit: vi.fn().mockResolvedValue(rows),
    then: (resolve: (value: Record<string, unknown>[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return query;
}

describe("GET /v1/models 子密钥属主隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractBearer.mockReturnValue("sk-test");
    mocks.getSchema.mockReturnValue(schema);
    mocks.verifyKey.mockResolvedValue({
      ctx: { userId: "user-1", apiKeyId: "sub-1", keyKind: "sub", source: "gateway" },
      record: { id: "sub-1" },
    });
  });

  it("历史跨用户绑定不会出现在响应中", async () => {
    const selectedRows = [
      [{ modelId: "own-model" }, { modelId: "foreign-model" }],
      [{ id: "own-model", name: "own-model", ownerUserId: "user-1", enabled: true }],
      [],
    ];
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => queryReturning(selectedRows.shift() ?? [])),
    });

    const response = await GET(new NextRequest("http://localhost/v1/models", {
      headers: { authorization: "Bearer sk-test" },
    }));
    const body = await response.json();

    expect(body.data.map((model: { id: string }) => model.id)).toEqual(["own-model"]);
    expect(mocks.eq).toHaveBeenCalledWith(schema.models.ownerUserId, "user-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.models.enabled, true);
  });
});
