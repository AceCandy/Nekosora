import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  extractBearer: vi.fn(),
  verifyKey: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  consumeGatewayGovernanceRate: vi.fn(),
  acquireGatewayGovernanceLease: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
}));

vi.mock("drizzle-orm", () => ({ eq: mocks.eq, and: mocks.and }));
vi.mock("@/lib/keys", () => ({
  extractBearer: mocks.extractBearer,
  verifyKey: mocks.verifyKey,
}));
vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));
vi.mock("@/lib/rag/retrieve", () => ({ retrieve: vi.fn() }));
vi.mock("@/lib/routing", () => ({ resolveRoutesByCapability: vi.fn() }));
vi.mock("@/lib/gateway-governance/lifecycle", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/gateway-governance/lifecycle")>(),
  consumeGatewayGovernanceRate: mocks.consumeGatewayGovernanceRate,
  acquireGatewayGovernanceLease: mocks.acquireGatewayGovernanceLease,
}));

import { POST } from "./route";

const schema = {
  models: {
    id: "models.id",
    name: "models.name",
    displayName: "models.displayName",
    enabled: "models.enabled",
    ownerUserId: "models.ownerUserId",
  },
  keyModelBindings: {
    keyId: "bindings.keyId",
    modelId: "bindings.modelId",
  },
};

function request() {
  return new NextRequest("http://localhost/v1/mcp", {
    method: "POST",
    headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_models", arguments: {} },
    }),
  });
}

function dbReturning(rows: Record<string, unknown>[]) {
  const query = {
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    where: vi.fn(() => query),
    then: (resolve: (value: Record<string, unknown>[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return { db: { select: vi.fn(() => query) }, query };
}

describe("MCP list_models 子密钥约束", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractBearer.mockReturnValue("sk-test");
    mocks.getSchema.mockReturnValue(schema);
    mocks.consumeGatewayGovernanceRate.mockResolvedValue({});
  });

  it("master key 返回当前用户全部已启用模型", async () => {
    const { db, query } = dbReturning([
      { name: "model-a", display: "Model A" },
      { name: "model-b", display: "Model B" },
    ]);
    mocks.getDb.mockResolvedValue(db);
    mocks.verifyKey.mockResolvedValue({
      ctx: { userId: "user-1", apiKeyId: "master-1", keyKind: "master", source: "gateway" },
    });

    const response = await POST(request());
    const body = await response.json();

    expect(body.result.content[0].text).toContain("model-a");
    expect(body.result.content[0].text).toContain("model-b");
    expect(mocks.consumeGatewayGovernanceRate).toHaveBeenCalledWith({
      identity: { userId: "user-1", apiKeyId: "master-1" },
      operation: "mcp.request",
    });
    expect(mocks.acquireGatewayGovernanceLease).not.toHaveBeenCalled();
    expect(query.innerJoin).not.toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith(schema.models.ownerUserId, "user-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.models.enabled, true);
  });

  it("sub key 通过绑定表只返回已绑定模型", async () => {
    const { db, query } = dbReturning([{ name: "model-a", display: "Model A" }]);
    mocks.getDb.mockResolvedValue(db);
    mocks.verifyKey.mockResolvedValue({
      ctx: { userId: "user-1", apiKeyId: "sub-1", keyKind: "sub", source: "gateway" },
    });

    const response = await POST(request());
    const body = await response.json();

    expect(body.result.content[0].text).toContain("model-a");
    expect(query.innerJoin).toHaveBeenCalledWith(
      schema.models,
      { op: "eq", left: schema.keyModelBindings.modelId, right: schema.models.id },
    );
    expect(mocks.eq).toHaveBeenCalledWith(schema.keyModelBindings.keyId, "sub-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.models.ownerUserId, "user-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.models.enabled, true);
  });

  it("无绑定的 sub key 返回空列表提示", async () => {
    const { db } = dbReturning([]);
    mocks.getDb.mockResolvedValue(db);
    mocks.verifyKey.mockResolvedValue({
      ctx: { userId: "user-1", apiKeyId: "sub-empty", keyKind: "sub", source: "gateway" },
    });

    const response = await POST(request());
    const body = await response.json();

    expect(body.result.content).toEqual([{ type: "text", text: "无可用模型" }]);
  });
});
