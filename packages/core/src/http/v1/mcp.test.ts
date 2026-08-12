import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractBearer: vi.fn(),
  verifyKey: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  retrieve: vi.fn(),
  consumeGatewayGovernanceRate: vi.fn(),
  acquireGatewayGovernanceLease: vi.fn(),
  finalize: vi.fn(),
  governanceSignal: new AbortController().signal,
}));

vi.mock("@/lib/keys", () => ({
  extractBearer: mocks.extractBearer,
  verifyKey: mocks.verifyKey,
}));
vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));
vi.mock("@/lib/routing", () => ({ resolveRoutesByCapability: vi.fn() }));
vi.mock("@/lib/rag/retrieve", () => ({ retrieve: mocks.retrieve }));
vi.mock("@/lib/gateway-governance/lifecycle", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/gateway-governance/lifecycle")>(),
  consumeGatewayGovernanceRate: mocks.consumeGatewayGovernanceRate,
  acquireGatewayGovernanceLease: mocks.acquireGatewayGovernanceLease,
}));

import { GovernanceRejectedError } from "@/lib/gateway-governance/repository";
import { GET, POST } from "./mcp";

const policy = { version: 1 };

function request(method: string, params?: Record<string, unknown>): Request {
  return new Request("http://localhost/v1/mcp", {
    method: "POST",
    headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

describe("POST /v1/mcp", () => {
  beforeEach(() => {
    mocks.extractBearer.mockReset().mockReturnValue("sk-test");
    mocks.verifyKey.mockReset().mockResolvedValue({
      ctx: { userId: "user-1", apiKeyId: "key-1", keyKind: "master", source: "gateway" },
    });
    mocks.getDb.mockReset();
    mocks.getSchema.mockReset();
    mocks.retrieve.mockReset().mockResolvedValue({ chunks: [] });
    mocks.consumeGatewayGovernanceRate.mockReset().mockResolvedValue(policy);
    mocks.finalize.mockReset().mockResolvedValue({ settled: true });
    mocks.acquireGatewayGovernanceLease.mockReset().mockResolvedValue({
      signal: mocks.governanceSignal,
      finalize: mocks.finalize,
    });
  });

  it("内部异常不暴露原始错误", async () => {
    mocks.getDb.mockRejectedValue(new Error("postgres://user:secret@db/internal"));
    const response = await POST(request("tools/call", {
      name: "list_models",
      arguments: {},
    }));

    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "Internal error" },
    });
  });

  it.each([
    ["initialize", undefined],
    ["tools/list", undefined],
    ["tools/call", { name: "unknown", arguments: {} }],
  ])("%s 只消费 Rate，不获取并发租约", async (method, params) => {
    await POST(request(method, params));

    expect(mocks.consumeGatewayGovernanceRate).toHaveBeenCalledWith({
      identity: { userId: "user-1", apiKeyId: "key-1" },
      operation: "mcp.request",
    });
    expect(mocks.acquireGatewayGovernanceLease).not.toHaveBeenCalled();
  });

  it("Rate 拒绝发生在 JSON 解析之前", async () => {
    mocks.consumeGatewayGovernanceRate.mockRejectedValueOnce(new GovernanceRejectedError({
      reason: "rate",
      scope: "key",
      retryAfterSeconds: 4,
    }));
    const malformed = new Request("http://localhost/v1/mcp", {
      method: "POST",
      headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
      body: "{",
    });

    const response = await POST(malformed);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("4");
    expect(mocks.acquireGatewayGovernanceLease).not.toHaveBeenCalled();
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("search_knowledge 使用 acquire-only lease 包裹 RAG 并结算", async () => {
    const req = request("tools/call", {
      name: "search_knowledge",
      arguments: { query: "gateway" },
    });

    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(mocks.acquireGatewayGovernanceLease).toHaveBeenCalledWith({
      identity: { userId: "user-1", apiKeyId: "key-1" },
      operation: "mcp.search",
      policy,
      requestSignal: req.signal,
    });
    expect(mocks.retrieve).toHaveBeenCalledWith(
      "gateway",
      [],
      { userId: "user-1", topK: 5 },
    );
    expect(mocks.finalize).toHaveBeenCalledWith(undefined);
  });

  it("search_knowledge 异常仍释放 lease", async () => {
    mocks.retrieve.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await POST(request("tools/call", {
      name: "search_knowledge",
      arguments: { query: "gateway" },
    }));

    expect(await response.json()).toMatchObject({ error: { code: -32603 } });
    expect(mocks.finalize).toHaveBeenCalledWith(undefined);
  });

  it("缺少 query 不获取 lease 或调用 RAG", async () => {
    await POST(request("tools/call", {
      name: "search_knowledge",
      arguments: {},
    }));

    expect(mocks.acquireGatewayGovernanceLease).not.toHaveBeenCalled();
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("GET 固定 405 且不参与治理", async () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(mocks.consumeGatewayGovernanceRate).not.toHaveBeenCalled();
    expect(mocks.acquireGatewayGovernanceLease).not.toHaveBeenCalled();
  });
});
