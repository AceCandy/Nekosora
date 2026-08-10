import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  extractBearer: vi.fn((header: string | null) => {
    const match = header?.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() ?? null;
  }),
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
    name: "models.name",
    displayName: "models.displayName",
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

describe("GET /v1/models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchema.mockReturnValue(schema);
    mocks.verifyKey.mockResolvedValue({
      ctx: { userId: "user-1", apiKeyId: "sub-1", keyKind: "sub", source: "gateway" },
      record: { id: "sub-1" },
    });
  });

  it("历史跨用户绑定不会出现在响应中", async () => {
    const selectedRows = [
      [{ modelId: "own-model" }, { modelId: "foreign-model" }],
      [{ id: "own-model", name: "own-model", displayName: "Own Model" }],
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
    expect(body.object).toBe("list");
    expect(mocks.eq).toHaveBeenCalledWith(schema.keyModelBindings.keyId, "sub-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.models.ownerUserId, "user-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.models.enabled, true);
  });

  it.each([
    [{ "x-api-key": "sk-test", "anthropic-version": "2023-06-01" }],
    [{ authorization: "Bearer sk-test", "anthropic-version": "2023-06-01" }],
  ])("使用 Anthropic 请求头返回原生模型列表", async (headers) => {
    mocks.verifyKey.mockResolvedValue({
      ctx: { userId: "user-1", apiKeyId: "master-1", keyKind: "master", source: "gateway" },
      record: { id: "master-1" },
    });
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => queryReturning([
        { id: "model-b", displayName: null },
        { id: "model-a", displayName: "Model A" },
      ])),
    });

    const response = await GET(new NextRequest("http://localhost/v1/models?limit=1", {
      headers,
    }));

    expect(response.status).toBe(200);
    expect(mocks.verifyKey).toHaveBeenCalledWith("sk-test");
    expect(await response.json()).toEqual({
      data: [{
        id: "model-a",
        created_at: "1970-01-01T00:00:00.000Z",
        display_name: "Model A",
        type: "model",
      }],
      first_id: "model-a",
      has_more: true,
      last_id: "model-a",
    });
    expect(mocks.eq).toHaveBeenCalledWith(schema.models.ownerUserId, "user-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.models.enabled, true);
  });

  it.each([
    ["after_id=model-a&limit=1", ["model-b"]],
    ["before_id=model-c&limit=1", ["model-b"]],
  ])("支持 Anthropic 游标分页: %s", async (query, expectedIds) => {
    mocks.verifyKey.mockResolvedValue({
      ctx: { userId: "user-1", apiKeyId: "master-1", keyKind: "master", source: "gateway" },
      record: { id: "master-1" },
    });
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => queryReturning([
        { id: "model-c", displayName: "Model C" },
        { id: "model-a", displayName: "Model A" },
        { id: "model-b", displayName: "Model B" },
      ])),
    });

    const response = await GET(new NextRequest(
      `http://localhost/v1/models?${query}`,
      { headers: { "x-api-key": "sk-test" } },
    ));
    const body = await response.json();

    expect(body.data.map((model: { id: string }) => model.id)).toEqual(expectedIds);
    expect(body.has_more).toBe(true);
  });

  it("Anthropic 游标到末尾时返回合法空页", async () => {
    mocks.verifyKey.mockResolvedValue({
      ctx: { userId: "user-1", apiKeyId: "master-1", keyKind: "master", source: "gateway" },
      record: { id: "master-1" },
    });
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => queryReturning([{ id: "model-a", displayName: "Model A" }])),
    });

    const response = await GET(new NextRequest(
      "http://localhost/v1/models?after_id=model-a",
      { headers: { "x-api-key": "sk-test" } },
    ));

    expect(await response.json()).toEqual({
      data: [],
      first_id: null,
      has_more: false,
      last_id: null,
    });
  });

  it("冲突 Key 返回 Anthropic 原生认证错误", async () => {
    const response = await GET(new NextRequest("http://localhost/v1/models", {
      headers: {
        authorization: "Bearer sk-openai",
        "x-api-key": "sk-anthropic",
      },
    }));

    expect(response.status).toBe(401);
    expect(mocks.verifyKey).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      type: "error",
      error: { type: "authentication_error", message: "无效的 API 密钥" },
    });
  });

  it.each([
    ["limit=0", "Invalid parameter: 'limit'. Expected an integer between 1 and 1000."],
    ["limit=1001", "Invalid parameter: 'limit'. Expected an integer between 1 and 1000."],
    ["limit=abc", "Invalid parameter: 'limit'. Expected an integer between 1 and 1000."],
    ["limit=1&limit=2", "Invalid parameter: 'limit'. Expected a single value."],
    ["after_id=model-a&before_id=model-b", "Invalid parameter: 'after_id'. Cannot be combined with 'before_id'."],
    ["order=desc", "Unsupported parameter: 'order'."],
  ])("非法 Anthropic 参数在查询数据库前返回 400: %s", async (query, message) => {
    const response = await GET(new NextRequest(`http://localhost/v1/models?${query}`, {
      headers: { "x-api-key": "sk-test" },
    }));

    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      type: "error",
      error: {
        type: "invalid_request_error",
        message,
      },
    });
  });

  it("未知 Anthropic cursor 不泄露其他模型", async () => {
    mocks.verifyKey.mockResolvedValue({
      ctx: { userId: "user-1", apiKeyId: "master-1", keyKind: "master", source: "gateway" },
      record: { id: "master-1" },
    });
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => queryReturning([{ id: "visible-model", displayName: "Visible" }])),
    });

    const response = await GET(new NextRequest(
      "http://localhost/v1/models?after_id=other-users-model",
      { headers: { "x-api-key": "sk-test" } },
    ));

    expect(response.status).toBe(400);
    expect(mocks.getDb).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Invalid parameter: 'after_id'. Unknown model ID.",
      },
    });
  });
});
