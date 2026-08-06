import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractBearer: vi.fn(),
  verifyKey: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/keys", () => ({
  extractBearer: mocks.extractBearer,
  verifyKey: mocks.verifyKey,
}));
vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: vi.fn(),
}));
vi.mock("@/lib/routing", () => ({ resolveRoutesByCapability: vi.fn() }));
vi.mock("@/lib/rag/retrieve", () => ({ retrieve: vi.fn() }));

import { POST } from "./mcp";

describe("POST /v1/mcp", () => {
  beforeEach(() => {
    mocks.extractBearer.mockReset().mockReturnValue("sk-test");
    mocks.verifyKey.mockReset().mockResolvedValue({
      ctx: { userId: "user-1", apiKeyId: "key-1", keyKind: "master", source: "gateway" },
    });
    mocks.getDb.mockReset();
  });

  it("内部异常不暴露原始错误", async () => {
    mocks.getDb.mockRejectedValue(new Error("postgres://user:secret@db/internal"));
    const response = await POST(new Request("http://localhost/v1/mcp", {
      method: "POST",
      headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_models", arguments: {} },
      }),
    }));

    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "Internal error" },
    });
  });
});
