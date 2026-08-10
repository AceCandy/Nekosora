import { beforeEach, describe, expect, it, vi } from "vitest";

const mockData = vi.hoisted(() => ({
  admin: { id: "admin-a", role: "admin" },
  models: [] as Record<string, unknown>[],
  catalogs: [] as Record<string, unknown>[],
  providers: [] as Record<string, unknown>[],
  routes: [] as Record<string, unknown>[],
}));

const mockFunctions = vi.hoisted(() => ({
  parseKeyBundle: vi.fn(() => [{ key: "secret", weight: 1 }]),
  pickWeightedKey: vi.fn(() => "secret"),
  probeProviderKey: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
  fetchUpstreamModels: vi.fn(async () => []),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, value: unknown) => ({ type: "eq", col, value }),
  ne: (col: string, value: unknown) => ({ type: "ne", col, value }),
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  or: (...conditions: unknown[]) => ({ type: "or", conditions }),
  asc: (col: string) => ({ type: "asc", col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: "sql", strings, values }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn(async () => mockData.admin) }));
vi.mock("@/lib/providers/keys", () => ({
  encryptKeyBundle: vi.fn(),
  parseKeyBundle: mockFunctions.parseKeyBundle,
  pickWeightedKey: mockFunctions.pickWeightedKey,
}));
vi.mock("@/lib/providers/probe", () => ({
  probeProviderKey: mockFunctions.probeProviderKey,
  fetchUpstreamModels: mockFunctions.fetchUpstreamModels,
}));
vi.mock("@/lib/circuit-breaker", () => ({
  recordSuccess: mockFunctions.recordSuccess,
  recordFailure: mockFunctions.recordFailure,
}));
vi.mock("@/lib/system-settings/ua", () => ({ getProbeHeaders: vi.fn(async () => ({})) }));

vi.mock("@/lib/infra/db", () => {
  type Condition =
    | { type: "eq" | "ne"; col: string; value: unknown }
    | { type: "and" | "or"; conditions: Condition[] };

  function matches(row: Record<string, unknown>, condition: Condition | undefined): boolean {
    if (!condition) return true;
    if (condition.type === "eq") return row[condition.col] === condition.value;
    if (condition.type === "ne") return row[condition.col] !== condition.value;
    if (condition.type === "or") return condition.conditions.some((item) => matches(row, item));
    return condition.conditions.every((item) => matches(row, item));
  }

  function makeQuery(rows: Record<string, unknown>[], fields?: Record<string, unknown>) {
    const query = {
      where(condition: Condition) {
        return makeQuery(rows.filter((row) => matches(row, condition)), fields);
      },
      limit(count: number) {
        return makeQuery(rows.slice(0, count), fields);
      },
      then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
        const selected = fields
          ? rows.map((row) => Object.fromEntries(
              Object.entries(fields).map(([key, column]) => [key, row[column as string]]),
            ))
          : rows;
        return Promise.resolve(selected).then(resolve, reject);
      },
    };
    return query;
  }

  const schema = {
    models: {
      __table: "models",
      id: "id",
      ownerUserId: "ownerUserId",
      visibility: "visibility",
      name: "name",
      catalogId: "catalogId",
      sortOrder: "sortOrder",
    },
    modelCatalog: {
      __table: "modelCatalog",
      id: "id",
      name: "name",
      canonicalModelId: "canonicalModelId",
      modelType: "modelType",
    },
    providers: {
      __table: "providers",
      id: "id",
      ownerUserId: "ownerUserId",
      protocol: "protocol",
      supportsStreamUsage: "supportsStreamUsage",
    },
    routes: {
      __table: "routes",
      id: "id",
      ownerUserId: "ownerUserId",
      modelId: "modelId",
      providerId: "providerId",
      upstreamModelName: "upstreamModelName",
      apiFormat: "apiFormat",
    },
  };

  function rowsForTable(table: { __table?: string }) {
    if (table.__table === "modelCatalog") return mockData.catalogs;
    if (table.__table === "providers") return mockData.providers;
    if (table.__table === "routes") return mockData.routes;
    return mockData.models;
  }

  const db = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: { __table?: string }) => makeQuery(rowsForTable(table), fields),
    }),
    insert: (table: { __table?: string }) => ({
      values: (row: Record<string, unknown>) => {
        let id = "";
        if (table.__table === "models") {
          id = `model-${mockData.models.length + 1}`;
          mockData.models.push({ id, ...row });
        } else if (table.__table === "providers") {
          id = `provider-${mockData.providers.length + 1}`;
          mockData.providers.push({ id, ...row });
        } else if (table.__table === "routes") {
          id = `route-${mockData.routes.length + 1}`;
          mockData.routes.push({ id, ...row });
        }
        return { returning: async () => [{ id }] };
      },
    }),
    update: (table: { __table?: string }) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (condition: Condition) => {
          for (const row of rowsForTable(table)) {
            if (matches(row, condition)) Object.assign(row, patch);
          }
        },
      }),
    }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const models = mockData.models.map((row) => ({ ...row }));
      const routes = mockData.routes.map((row) => ({ ...row }));
      try {
        return await callback(db);
      } catch (error) {
        mockData.models = models;
        mockData.routes = routes;
        throw error;
      }
    },
  };

  return { getDb: async () => db, getSchema: () => schema };
});

import {
  attachProviderModelRoute,
  createProvider,
  createModel,
  createRoute,
  testRoute,
  updateProvider,
  updateRoute,
} from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockData.models = [
    { id: "private-a", ownerUserId: "admin-a", visibility: "private", name: "private-a", catalogId: "catalog-chat" },
    { id: "private-b", ownerUserId: "user-b", visibility: "private", name: "private-b", catalogId: "catalog-chat" },
    { id: "public-b", ownerUserId: "user-b", visibility: "public", name: "public-b", catalogId: "catalog-chat" },
  ];
  mockData.catalogs = [{ id: "catalog-chat", name: "Chat", canonicalModelId: "__generic_chat__", modelType: "chat" }];
  mockData.providers = [{
    id: "provider-a",
    ownerUserId: "admin-a",
    name: "Provider A",
    protocol: "openai",
    baseUrl: "https://api.example.com/v1",
    supportsStreamUsage: false,
  }];
  mockData.routes = [];
});

describe("updateProvider", () => {
  it("保存 Provider 配置时重置流式 usage 能力", async () => {
    const formData = new FormData();
    formData.set("name", "Provider A");
    formData.set("protocol", "openai-compatible");
    formData.set("baseUrl", "https://api.example.com/v1");
    formData.set("testModel", "model-a");

    await updateProvider("provider-a", formData);

    expect(mockData.providers[0]).toEqual(expect.objectContaining({
      supportsStreamUsage: null,
    }));
  });

  it("无 marker 时保留旧超时值", async () => {
    Object.assign(mockData.providers[0], {
      connectTimeoutMs: 2_000,
      readTimeoutMs: 20_000,
      streamIdleTimeoutMs: 6_000,
    });
    const formData = new FormData();
    formData.set("name", "Provider A");
    formData.set("protocol", "openai");
    formData.set("baseUrl", "https://api.example.com/v1");

    await updateProvider("provider-a", formData);

    expect(mockData.providers[0]).toEqual(expect.objectContaining({
      connectTimeoutMs: 2_000,
      readTimeoutMs: 20_000,
      streamIdleTimeoutMs: 6_000,
    }));
  });

  it("有 marker 时更新并可清空超时值", async () => {
    const formData = new FormData();
    formData.set("name", "Provider A");
    formData.set("protocol", "openai");
    formData.set("baseUrl", "https://api.example.com/v1");
    formData.set("providerTimeoutsPresent", "1");
    formData.set("connectTimeoutSeconds", "1.25");
    formData.set("readTimeoutSeconds", "");
    formData.set("streamIdleTimeoutSeconds", "5");

    await updateProvider("provider-a", formData);

    expect(mockData.providers[0]).toEqual(expect.objectContaining({
      connectTimeoutMs: 1_250,
      readTimeoutMs: null,
      streamIdleTimeoutMs: 5_000,
    }));
  });
});

describe("createProvider", () => {
  it("创建时把表单秒值保存为 nullable 毫秒值", async () => {
    const formData = new FormData();
    formData.set("name", "Provider B");
    formData.set("protocol", "openai");
    formData.set("baseUrl", "https://api.example.com/v1");
    formData.set("connectTimeoutSeconds", "60");
    formData.set("readTimeoutSeconds", "");
    formData.set("streamIdleTimeoutSeconds", "120.5");

    await createProvider(formData);

    expect(mockData.providers.at(-1)).toEqual(expect.objectContaining({
      connectTimeoutMs: 60_000,
      readTimeoutMs: null,
      streamIdleTimeoutMs: 120_500,
    }));
    expect(mockFunctions.fetchUpstreamModels).toHaveBeenCalledWith(expect.objectContaining({
      connectTimeoutMs: 60_000,
      readTimeoutMs: null,
      streamIdleTimeoutMs: 120_500,
    }));
  });
});

describe("createModel", () => {
  it("允许使用自己的服务商创建模型和初始路由", async () => {
    const formData = new FormData();
    formData.set("name", "model-new");
    formData.set("catalogId", "catalog-chat");
    formData.set("providerId", "provider-a");
    formData.set("upstreamModelName", "upstream-a");

    await expect(createModel(formData)).resolves.toBeUndefined();
    const model = mockData.models.find((row) => row.name === "model-new");
    expect(model).toEqual(expect.objectContaining({ ownerUserId: "admin-a" }));
    expect(mockData.routes).toContainEqual(expect.objectContaining({
      ownerUserId: "admin-a",
      modelId: model?.id,
      providerId: "provider-a",
      upstreamModelName: "upstream-a",
      apiFormat: "openai-chat",
    }));
  });

  it("拒绝使用其他管理员的服务商并回滚模型创建", async () => {
    mockData.providers = [{ id: "provider-b", ownerUserId: "admin-b" }];
    const formData = new FormData();
    formData.set("name", "model-new");
    formData.set("catalogId", "catalog-chat");
    formData.set("providerId", "provider-b");
    formData.set("upstreamModelName", "upstream-b");

    await expect(createModel(formData)).rejects.toThrow("服务商不存在");
    expect(mockData.models).not.toContainEqual(expect.objectContaining({ name: "model-new" }));
    expect(mockData.routes).toHaveLength(0);
  });

  it("提交服务商但未填写上游模型时仍校验服务商归属", async () => {
    mockData.providers = [{ id: "provider-b", ownerUserId: "admin-b" }];
    const formData = new FormData();
    formData.set("name", "model-new");
    formData.set("catalogId", "catalog-chat");
    formData.set("providerId", "provider-b");

    await expect(createModel(formData)).rejects.toThrow("服务商不存在");
    expect(mockData.models).not.toContainEqual(expect.objectContaining({ name: "model-new" }));
    expect(mockData.routes).toHaveLength(0);
  });
});

describe("createRoute", () => {
  it.each([
    ["自己的私有模型", "private-a", "admin-a"],
    ["可管理的公共模型", "public-b", "user-b"],
  ])("允许给%s绑定自己的服务商", async (_label, modelId, routeOwnerId) => {
    const formData = new FormData();
    formData.set("providerId", "provider-a");
    formData.set("upstreamModelName", "upstream-a");
    formData.set("supportsToolsPresent", "true");
    formData.set("supportsTools", "on");

    await expect(createRoute(modelId, formData)).resolves.toBeUndefined();
    expect(mockData.routes).toContainEqual(expect.objectContaining({
      ownerUserId: routeOwnerId,
      modelId,
      providerId: "provider-a",
      upstreamModelName: "upstream-a",
      apiFormat: "openai-chat",
      supportsTools: true,
    }));
  });

  it("未提供工具能力时默认开启", async () => {
    const formData = new FormData();
    formData.set("providerId", "provider-a");
    formData.set("upstreamModelName", "upstream-a");

    await createRoute("private-a", formData);

    expect(mockData.routes[0]).toEqual(expect.objectContaining({ supportsTools: true }));
  });

  it("表单明确取消工具能力时保存关闭", async () => {
    const formData = new FormData();
    formData.set("providerId", "provider-a");
    formData.set("upstreamModelName", "upstream-a");
    formData.set("supportsToolsPresent", "true");

    await createRoute("private-a", formData);

    expect(mockData.routes[0]).toEqual(expect.objectContaining({ supportsTools: false }));
  });

  it("保存显式选择的上游 API 格式", async () => {
    const formData = new FormData();
    formData.set("providerId", "provider-a");
    formData.set("upstreamModelName", "upstream-a");
    formData.set("apiFormat", "openai-responses");

    await createRoute("private-a", formData);

    expect(mockData.routes[0]).toEqual(expect.objectContaining({ apiFormat: "openai-responses" }));
  });

  it("拒绝给 chat 模型选择媒体 API 格式", async () => {
    const formData = new FormData();
    formData.set("providerId", "provider-a");
    formData.set("upstreamModelName", "upstream-a");
    formData.set("apiFormat", "openai-images");

    await expect(createRoute("private-a", formData)).rejects.toThrow("上游 API 格式与模型类型不匹配");
    expect(mockData.routes).toHaveLength(0);
  });

  it("拒绝使用其他管理员的服务商", async () => {
    mockData.providers = [{ id: "provider-b", ownerUserId: "admin-b" }];
    const formData = new FormData();
    formData.set("providerId", "provider-b");
    formData.set("upstreamModelName", "upstream-b");

    await expect(createRoute("private-a", formData)).rejects.toThrow("服务商不存在");
    expect(mockData.routes).toHaveLength(0);
  });
});

describe("updateRoute", () => {
  it.each([
    ["自己的私有路由", "private-a", "admin-a"],
    ["可管理的公共路由", "public-b", "user-b"],
  ])("允许更新%s并改用自己的服务商", async (_label, modelId, ownerUserId) => {
    mockData.routes = [{
      id: "route-a",
      ownerUserId,
      modelId,
      providerId: "provider-old",
      upstreamModelName: "upstream-old",
      priority: 0,
      weight: 1,
      apiFormat: "openai-chat",
    }];
    const formData = new FormData();
    formData.set("providerId", "provider-a");
    formData.set("upstreamModelName", "upstream-a");
    formData.set("priority", "2");
    formData.set("weight", "3");
    formData.set("supportsTools", "on");

    await expect(updateRoute("route-a", formData)).resolves.toBeUndefined();
    expect(mockData.routes[0]).toEqual(expect.objectContaining({
      providerId: "provider-a",
      upstreamModelName: "upstream-a",
      priority: 2,
      weight: 3,
      supportsTools: true,
    }));
  });

  it("允许保存关闭工具能力", async () => {
    mockData.routes = [{
      id: "route-a",
      ownerUserId: "admin-a",
      modelId: "private-a",
      providerId: "provider-a",
      upstreamModelName: "upstream-a",
      supportsTools: true,
    }];
    const formData = new FormData();
    formData.set("providerId", "provider-a");
    formData.set("upstreamModelName", "upstream-a");
    formData.set("supportsToolsPresent", "true");

    await updateRoute("route-a", formData);

    expect(mockData.routes[0]).toEqual(expect.objectContaining({ supportsTools: false }));
  });

  it("更新未提供工具能力时保持原值", async () => {
    mockData.routes = [{
      id: "route-a",
      ownerUserId: "admin-a",
      modelId: "private-a",
      providerId: "provider-a",
      upstreamModelName: "upstream-a",
      supportsTools: true,
      apiFormat: "openai-chat",
    }];
    const formData = new FormData();
    formData.set("providerId", "provider-a");
    formData.set("upstreamModelName", "upstream-b");

    await updateRoute("route-a", formData);

    expect(mockData.routes[0]).toEqual(expect.objectContaining({
      supportsTools: true,
      apiFormat: "openai-chat",
    }));
  });

  it("显式提供格式时更新 route", async () => {
    mockData.routes = [{
      id: "route-a",
      ownerUserId: "admin-a",
      modelId: "private-a",
      providerId: "provider-a",
      upstreamModelName: "upstream-a",
      apiFormat: "openai-chat",
    }];
    const formData = new FormData();
    formData.set("providerId", "provider-a");
    formData.set("upstreamModelName", "upstream-a");
    formData.set("apiFormat", "anthropic-messages");

    await updateRoute("route-a", formData);

    expect(mockData.routes[0]).toEqual(expect.objectContaining({ apiFormat: "anthropic-messages" }));
  });

  it("拒绝改用其他管理员的服务商", async () => {
    mockData.providers = [{ id: "provider-b", ownerUserId: "admin-b" }];
    mockData.routes = [{
      id: "route-a",
      ownerUserId: "admin-a",
      modelId: "private-a",
      providerId: "provider-a",
      upstreamModelName: "upstream-a",
      priority: 0,
      weight: 1,
    }];
    const formData = new FormData();
    formData.set("providerId", "provider-b");
    formData.set("upstreamModelName", "upstream-b");

    await expect(updateRoute("route-a", formData)).rejects.toThrow("服务商不存在");
    expect(mockData.routes[0]).toEqual(expect.objectContaining({
      providerId: "provider-a",
      upstreamModelName: "upstream-a",
    }));
  });
});

describe("testRoute", () => {
  it.each([
    ["自己的私有路由", "private-a", "admin-a"],
    ["可管理的公共路由", "public-b", "user-b"],
  ])("允许探测%s", async (_label, modelId, ownerUserId) => {
    const providerId = `provider-${modelId}`;
    mockData.providers = [{
      id: providerId,
      ownerUserId,
      apiKeysEnc: `encrypted-${modelId}`,
      protocol: "openai",
      baseUrl: `https://${providerId}.example`,
      connectTimeoutMs: 2_000,
      readTimeoutMs: 20_000,
      streamIdleTimeoutMs: 6_000,
    }];
    mockData.routes = [{
      id: `route-${modelId}`,
      ownerUserId,
      modelId,
      providerId,
      upstreamModelName: `upstream-${modelId}`,
      apiFormat: "openai-responses",
    }];

    await expect(testRoute(`route-${modelId}`)).resolves.toEqual({ ok: true, latencyMs: 1 });
    expect(mockFunctions.probeProviderKey).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "secret",
      upstreamModelName: `upstream-${modelId}`,
      apiFormat: "openai-responses",
      connectTimeoutMs: 2_000,
      readTimeoutMs: 20_000,
      streamIdleTimeoutMs: 6_000,
    }));
    expect(mockFunctions.recordSuccess).toHaveBeenCalledWith(providerId);
    expect(mockFunctions.recordFailure).not.toHaveBeenCalled();
  });

  it("拒绝探测其他用户的私有路由且不产生副作用", async () => {
    mockData.providers = [{
      id: "provider-b",
      ownerUserId: "user-b",
      apiKeysEnc: "encrypted-b",
      protocol: "openai",
      baseUrl: "https://provider-b.example",
    }];
    mockData.routes = [{
      id: "route-b",
      ownerUserId: "user-b",
      modelId: "private-b",
      providerId: "provider-b",
      upstreamModelName: "upstream-b",
    }];

    await expect(testRoute("route-b")).rejects.toThrow("无权操作");
    expect(mockFunctions.parseKeyBundle).not.toHaveBeenCalled();
    expect(mockFunctions.probeProviderKey).not.toHaveBeenCalled();
    expect(mockFunctions.recordSuccess).not.toHaveBeenCalled();
    expect(mockFunctions.recordFailure).not.toHaveBeenCalled();
  });
});

describe("attachProviderModelRoute", () => {
  it("可给公开模型补路由，重复绑定返回 exists", async () => {
    await expect(attachProviderModelRoute("public-b", "provider-a", "upstream-a"))
      .resolves.toEqual({ status: "created" });
    await expect(attachProviderModelRoute("public-b", "provider-a", "upstream-a"))
      .resolves.toEqual({ status: "exists" });

    expect(mockData.routes).toEqual([expect.objectContaining({
      ownerUserId: "user-b",
      modelId: "public-b",
      providerId: "provider-a",
      upstreamModelName: "upstream-a",
    })]);
  });

  it("拒绝给其他用户的私有模型补路由", async () => {
    await expect(attachProviderModelRoute("private-b", "provider-a", "upstream-a"))
      .rejects.toThrow("无权操作");
    expect(mockData.routes).toHaveLength(0);
  });

  it("拒绝使用其他管理员的服务商", async () => {
    mockData.providers = [{ id: "provider-b", ownerUserId: "admin-b" }];

    await expect(attachProviderModelRoute("private-a", "provider-b", "upstream-a"))
      .rejects.toThrow("服务商不存在");
    expect(mockData.routes).toHaveLength(0);
  });
});
