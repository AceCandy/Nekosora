import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  or: vi.fn((...conditions: unknown[]) => ({ op: "or", conditions })),
}));

vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));
vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: mocks.and,
  or: mocks.or,
}));

import {
  listWebSearchModelCandidates,
  parseWebSearchConfig,
  planWebSearchConfigBackfill,
  serializeWebSearchConfig,
  toWebSearchConfigDto,
} from "./registry";

beforeAll(() => {
  process.env.DATA_ENCRYPTION_KEY = "1".repeat(64);
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("联网搜索配置 V2", () => {
  it("V1 保留已启用 Provider 顺序并在末尾追加当前模型", () => {
    expect(parseWebSearchConfig({
      version: 1,
      providers: [
        { id: "a", type: "tavily", name: "A", apiKey: "key-a", enabled: true },
        { id: "b", type: "bocha", name: "B", apiKey: "key-b", enabled: false },
        { id: "c", type: "zhipu", name: "C", apiKey: "key-c", enabled: true },
      ],
    })).toEqual({
      version: 2,
      providers: [
        { id: "a", type: "tavily", name: "A", apiKey: "key-a", enabled: true },
        { id: "b", type: "bocha", name: "B", apiKey: "key-b", enabled: false },
        { id: "c", type: "zhipu", name: "C", apiKey: "key-c", enabled: true },
      ],
      backends: [
        { type: "provider", providerId: "a" },
        { type: "provider", providerId: "c" },
        { type: "current-model" },
      ],
    });
  });

  it("数据库只保存密文，客户端只得到 hasApiKey", () => {
    const runtime = {
      version: 2 as const,
      providers: [{ id: "exa", type: "exa" as const, name: "Exa", apiKey: "secret", enabled: true }],
      backends: [{ type: "provider" as const, providerId: "exa" }],
    };
    const stored = serializeWebSearchConfig(runtime);
    const dto = toWebSearchConfigDto(runtime);

    expect(stored.providers[0].apiKeyCiphertext).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain("secret");
    expect(dto.providers[0]).toEqual({ id: "exa", type: "exa", name: "Exa", enabled: true, hasApiKey: true });
    expect(JSON.stringify(dto)).not.toContain("secret");
    expect(parseWebSearchConfig(stored)).toEqual(runtime);
  });

  it("保存边界去除重复后端", () => {
    const stored = serializeWebSearchConfig({
      version: 2,
      providers: [],
      backends: [{ type: "current-model" }, { type: "current-model" }],
    });
    expect(stored.backends).toEqual([{ type: "current-model" }]);
  });

  it("回填计划只转换合法 V1 且不在输出保留明文", () => {
    const plan = planWebSearchConfigBackfill({
      version: 1,
      providers: [
        { id: "a", type: "tavily", name: "A", apiKey: "legacy-secret", enabled: true },
        { id: "b", type: "bocha", name: "B", enabled: false },
      ],
    });

    expect(plan.status).toBe("convert");
    expect(JSON.stringify(plan)).not.toContain("legacy-secret");
    if (plan.status === "convert") {
      expect(plan.providerCount).toBe(1);
      expect(plan.stored.backends).toEqual([
        { type: "provider", providerId: "a" },
        { type: "current-model" },
      ]);
      expect(plan.stored.providers[1]).toMatchObject({ id: "b", enabled: false });
    }
    expect(planWebSearchConfigBackfill({ version: 2, providers: [], backends: [] }))
      .toEqual({ status: "up-to-date" });
    expect(planWebSearchConfigBackfill({ version: 1, providers: "invalid" }))
      .toEqual({ status: "invalid", legacy: true });
  });

  it("候选模型仅保留目录已标记且路由协议兼容的可用模型", async () => {
    const schema = {
      models: {
        id: "models.id",
        name: "models.name",
        displayName: "models.displayName",
        catalogId: "models.catalogId",
        enabled: "models.enabled",
        visibility: "models.visibility",
        ownerUserId: "models.ownerUserId",
      },
      modelCatalog: {
        id: "modelCatalog.id",
        capabilities: "modelCatalog.capabilities",
        enabled: "modelCatalog.enabled",
      },
      routes: {
        modelId: "routes.modelId",
        providerId: "routes.providerId",
        enabled: "routes.enabled",
        supportsTools: "routes.supportsTools",
      },
      providers: {
        id: "providers.id",
        protocol: "providers.protocol",
        enabled: "providers.enabled",
      },
    };
    const rows = [
      {
        id: "gpt",
        name: "gpt-5.5",
        displayName: "GPT 5.5",
        capabilities: { webSearchFormat: "openai" },
        protocol: "openai",
        supportsTools: true,
      },
      {
        id: "gpt",
        name: "gpt-5.5",
        displayName: "GPT 5.5",
        capabilities: { webSearchFormat: "openai" },
        protocol: "openai",
        supportsTools: true,
      },
      {
        id: "bad-route",
        name: "wrong protocol",
        displayName: null,
        capabilities: { webSearchFormat: "google" },
        protocol: "openai",
        supportsTools: true,
      },
      {
        id: "unmarked",
        name: "no catalog capability",
        displayName: null,
        capabilities: {},
        protocol: "openai",
        supportsTools: true,
      },
      {
        id: "route-without-tools",
        name: "route without tools",
        displayName: null,
        capabilities: { webSearchFormat: "openai" },
        protocol: "openai",
        supportsTools: false,
      },
    ];
    const query = {
      innerJoin: vi.fn(() => query),
      where: vi.fn(() => Promise.resolve(rows)),
    };
    mocks.getSchema.mockReturnValue(schema);
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => ({ from: vi.fn(() => query) })),
    });

    await expect(listWebSearchModelCandidates("user-1")).resolves.toEqual([{
      id: "gpt",
      name: "gpt-5.5",
      displayName: "GPT 5.5",
    }]);
    expect(mocks.eq).toHaveBeenCalledWith(schema.models.enabled, true);
    expect(mocks.eq).toHaveBeenCalledWith(schema.modelCatalog.enabled, true);
    expect(mocks.eq).toHaveBeenCalledWith(schema.routes.enabled, true);
    expect(mocks.eq).toHaveBeenCalledWith(schema.providers.enabled, true);
    expect(mocks.eq).toHaveBeenCalledWith(schema.models.ownerUserId, "user-1");
  });
});
