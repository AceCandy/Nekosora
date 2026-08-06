import { beforeEach, describe, expect, it, vi } from "vitest";

const mockData = vi.hoisted(() => ({
  models: [] as Record<string, unknown>[],
  catalogs: [{ id: "catalog-chat", canonicalModelId: "__generic_chat__", aliases: [], enabled: true }],
  providers: [] as Record<string, unknown>[],
  routes: [] as Record<string, unknown>[],
  user: { id: "admin-a", role: "admin" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, value: unknown) => ({ type: "eq", col, value }),
  ne: (col: string, value: unknown) => ({ type: "ne", col, value }),
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  asc: (col: string) => ({ type: "asc", col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: "sql", strings, values }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => mockData.user) }));
vi.mock("@/lib/providers/keys", () => ({
  encryptKeyBundle: vi.fn(),
  parseKeyBundle: vi.fn(),
  pickWeightedKey: vi.fn(),
}));
vi.mock("@/lib/providers/probe", () => ({ probeProviderKey: vi.fn(), fetchUpstreamModels: vi.fn() }));
vi.mock("@/lib/circuit-breaker", () => ({ recordSuccess: vi.fn(), recordFailure: vi.fn() }));
vi.mock("@/lib/keys", () => ({
  createMasterKey: vi.fn(),
  createSubKey: vi.fn(),
  listKeys: vi.fn(),
  setKeyEnabled: vi.fn(),
}));

vi.mock("@/lib/infra/db", () => {
  type Condition =
    | { type: "eq" | "ne"; col: string; value: unknown }
    | { type: "and"; conditions: Condition[] };

  function matches(row: Record<string, unknown>, condition: Condition | undefined): boolean {
    if (!condition) return true;
    if (condition.type === "eq") return row[condition.col] === condition.value;
    if (condition.type === "ne") return row[condition.col] !== condition.value;
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
      orderBy() {
        return query;
      },
      then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
        if (fields && Object.values(fields).some((field) => (field as { type?: string }).type === "sql")) {
          const aggregate = Object.fromEntries(
            Object.entries(fields).map(([key, field]) => [
              key,
              (field as { type?: string }).type === "sql"
                ? Math.max(-1, ...rows.map((row) => Number(row.sortOrder ?? -1)))
                : undefined,
            ]),
          );
          return Promise.resolve([aggregate]).then(resolve, reject);
        }
        const selected = fields
          ? rows.map((row) =>
              Object.fromEntries(
                Object.entries(fields).map(([key, column]) => [key, row[column as string]]),
              ),
            )
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
      enabled: "enabled",
      sortOrder: "sortOrder",
      createdAt: "createdAt",
      name: "name",
    },
    modelCatalog: {
      __table: "modelCatalog",
      id: "id",
      enabled: "enabled",
      sortOrder: "sortOrder",
      name: "name",
    },
    providers: {
      __table: "providers",
      id: "id",
      ownerUserId: "ownerUserId",
      apiKeysEnc: "apiKeysEnc",
      protocol: "protocol",
      baseUrl: "baseUrl",
    },
    routes: {
      __table: "routes",
      id: "id",
      ownerUserId: "ownerUserId",
      modelId: "modelId",
      providerId: "providerId",
      upstreamModelName: "upstreamModelName",
    },
  };

  const db = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: { __table?: string }) => {
        const rows =
          table.__table === "modelCatalog"
            ? mockData.catalogs
            : table.__table === "providers"
              ? mockData.providers
              : table.__table === "routes"
                ? mockData.routes
                : mockData.models;
        return makeQuery(rows, fields);
      },
    }),
    update: (table?: { __table?: string }) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (condition: Condition) => {
          const rows = table?.__table === "providers"
            ? mockData.providers
            : table?.__table === "routes"
              ? mockData.routes
              : mockData.models;
          const apply = () => {
            let count = 0;
            for (const row of rows) {
              if (matches(row, condition)) {
                Object.assign(row, patch);
                count++;
              }
            }
            return { changes: count };
          };
          return {
            run: apply,
            then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(apply()).then(resolve, reject),
          };
        },
      }),
    }),
    insert: (table?: { __table?: string }) => ({
      values: async (row: Record<string, unknown>) => {
        if (table?.__table === "routes") {
          mockData.routes.push({ id: `route-${mockData.routes.length + 1}`, ...row });
        } else {
          mockData.models.push({ id: `model-${mockData.models.length + 1}`, ...row });
        }
      },
    }),
    transaction: async (callback: (tx: typeof db) => Promise<unknown>) => {
      return await callback(db);
    },
  };

  return { getDb: async () => db, getSchema: () => schema, isPg: false };
});

import { attachMyProviderModelRoute, createMyModel, createMyRoute, reorderMyModels, updateMyModel, updateMyRoute, checkMyProviderHealth, testMyProviderModel, testMyKeyDirect, getBindableModels } from "./actions";
import { probeProviderKey } from "@/lib/providers/probe";
import { parseKeyBundle, pickWeightedKey } from "@/lib/providers/keys";

beforeEach(() => {
  mockData.user = { id: "admin-a", role: "admin" };
  mockData.providers = [];
  mockData.routes = [];
  vi.mocked(probeProviderKey).mockReset();
  vi.mocked(parseKeyBundle).mockReset();
  mockData.models = [
    { id: "public-a", name: "public-a", ownerUserId: "admin-a", visibility: "public", sortOrder: 0 },
    { id: "public-b", name: "public-b", ownerUserId: "admin-a", visibility: "public", sortOrder: 1 },
    { id: "private-a", name: "private-a", ownerUserId: "admin-a", visibility: "private", sortOrder: 5 },
    { id: "private-b", name: "private-b", ownerUserId: "user-b", visibility: "private", sortOrder: 2 },
  ];
});

describe("attachMyProviderModelRoute", () => {
  beforeEach(() => {
    mockData.providers = [{ id: "provider-a", ownerUserId: "admin-a" }];
  });

  it("首次绑定创建路由，重复绑定返回 exists 且不重复写入", async () => {
    await expect(attachMyProviderModelRoute("private-a", "provider-a", "upstream-a"))
      .resolves.toEqual({ status: "created" });
    await expect(attachMyProviderModelRoute("private-a", "provider-a", "upstream-a"))
      .resolves.toEqual({ status: "exists" });

    expect(mockData.routes).toEqual([expect.objectContaining({
      ownerUserId: "admin-a",
      modelId: "private-a",
      providerId: "provider-a",
      upstreamModelName: "upstream-a",
    })]);
  });

  it("拒绝给其他用户的模型补路由", async () => {
    await expect(attachMyProviderModelRoute("private-b", "provider-a", "upstream-a"))
      .rejects.toThrow("模型不存在");
    expect(mockData.routes).toHaveLength(0);
  });

  it("拒绝使用其他用户的服务商", async () => {
    mockData.providers = [{ id: "provider-b", ownerUserId: "user-b" }];

    await expect(attachMyProviderModelRoute("private-a", "provider-b", "upstream-a"))
      .rejects.toThrow("服务商不存在");
    expect(mockData.routes).toHaveLength(0);
  });
});

describe("个人路由工具能力", () => {
  beforeEach(() => {
    mockData.providers = [{ id: "provider-a", ownerUserId: "admin-a" }];
  });

  it("创建和更新时保存显式工具能力", async () => {
    const createData = new FormData();
    createData.set("providerId", "provider-a");
    createData.set("upstreamModelName", "upstream-a");
    createData.set("supportsToolsPresent", "true");
    createData.set("supportsTools", "on");

    await createMyRoute("private-a", createData);
    expect(mockData.routes[0]).toEqual(expect.objectContaining({ supportsTools: true }));

    const updateData = new FormData();
    updateData.set("providerId", "provider-a");
    updateData.set("upstreamModelName", "upstream-b");
    updateData.set("supportsToolsPresent", "true");
    await updateMyRoute(mockData.routes[0].id as string, updateData);

    expect(mockData.routes[0]).toEqual(expect.objectContaining({
      upstreamModelName: "upstream-b",
      supportsTools: false,
    }));
  });

  it("更新未提供工具能力时保持原值", async () => {
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
    formData.set("upstreamModelName", "upstream-b");

    await updateMyRoute("route-a", formData);

    expect(mockData.routes[0]).toEqual(expect.objectContaining({ supportsTools: true }));
  });

  it("未提供工具能力时默认开启", async () => {
    const formData = new FormData();
    formData.set("providerId", "provider-a");
    formData.set("upstreamModelName", "upstream-a");

    await createMyRoute("private-a", formData);

    expect(mockData.routes[0]).toEqual(expect.objectContaining({ supportsTools: true }));
  });

  it("表单明确取消工具能力时保存关闭", async () => {
    const formData = new FormData();
    formData.set("providerId", "provider-a");
    formData.set("upstreamModelName", "upstream-a");
    formData.set("supportsToolsPresent", "true");

    await createMyRoute("private-a", formData);

    expect(mockData.routes[0]).toEqual(expect.objectContaining({ supportsTools: false }));
  });
});

describe("reorderMyModels", () => {
  it("重排公开组时不影响私有模型", async () => {
    await reorderMyModels("public", ["public-b", "public-a"]);

    expect(mockData.models.find((model) => model.id === "public-b")?.sortOrder).toBe(0);
    expect(mockData.models.find((model) => model.id === "public-a")?.sortOrder).toBe(1);
    expect(mockData.models.find((model) => model.id === "private-a")?.sortOrder).toBe(5);
  });

  it("重排私有组时不会更新其他用户的模型", async () => {
    await reorderMyModels("private", ["private-a", "private-b"]);

    expect(mockData.models.find((model) => model.id === "private-a")?.sortOrder).toBe(0);
    expect(mockData.models.find((model) => model.id === "private-b")?.sortOrder).toBe(2);
  });
});

describe("getBindableModels", () => {
  it("只返回当前用户自己的 enabled 模型", async () => {
    mockData.models.forEach((model) => { model.enabled = true; });

    const result = await getBindableModels();

    expect(result.globals).toEqual([]);
    expect(result.byos.map((model) => model.id)).toEqual(["public-a", "public-b", "private-a"]);
    expect(result.byos.some((model) => model.id === "private-b")).toBe(false);
  });
});

describe("setMyModelVisibility", () => {
  it("发布私有模型时将其追加到公开组末尾", async () => {
    const { setMyModelVisibility } = await import("./actions") as unknown as {
      setMyModelVisibility?: (id: string, visibility: "public" | "private") => Promise<void>;
    };

    expect(setMyModelVisibility).toBeTypeOf("function");
    if (!setMyModelVisibility) return;

    await setMyModelVisibility("private-a", "public");

    expect(mockData.models.find((model) => model.id === "private-a")).toMatchObject({
      visibility: "public",
      sortOrder: 2,
    });
  });

  it("发布时公开组存在同名模型会拒绝且保持原状态", async () => {
    mockData.models.push({
      id: "public-duplicate",
      name: "private-a",
      ownerUserId: "admin-a",
      visibility: "public",
      sortOrder: 2,
    });
    const { setMyModelVisibility } = await import("./actions") as unknown as {
      setMyModelVisibility?: (id: string, visibility: "public" | "private") => Promise<void>;
    };

    expect(setMyModelVisibility).toBeTypeOf("function");
    if (!setMyModelVisibility) return;

    await expect(setMyModelVisibility("private-a", "public")).rejects.toThrow("已存在同名 public 模型");
    expect(mockData.models.find((model) => model.id === "private-a")).toMatchObject({
      visibility: "private",
      sortOrder: 5,
    });
  });

  it("普通用户不能绕过界面直接发布模型", async () => {
    mockData.user = { id: "user-b", role: "user" };
    const { setMyModelVisibility } = await import("./actions") as unknown as {
      setMyModelVisibility: (id: string, visibility: "public" | "private") => Promise<void>;
    };

    await expect(setMyModelVisibility("private-b", "public")).rejects.toThrow("无权发布模型");
    expect(mockData.models.find((model) => model.id === "private-b")?.visibility).toBe("private");
  });
});

describe("模型创建与编辑", () => {
  it("新建公开模型时追加到公开组末尾", async () => {
    const formData = new FormData();
    formData.set("name", "public-new");
    formData.set("visibility", "public");
    formData.set("catalogId", "catalog-chat");

    await createMyModel(formData);

    expect(mockData.models.at(-1)).toMatchObject({
      name: "public-new",
      visibility: "public",
      sortOrder: 2,
    });
  });

  it("新建公开模型时拒绝已存在的公开名称", async () => {
    const formData = new FormData();
    formData.set("name", "public-a");
    formData.set("visibility", "public");
    formData.set("catalogId", "catalog-chat");

    await expect(createMyModel(formData)).rejects.toThrow("已存在同名 public 模型");
    expect(mockData.models).toHaveLength(4);
  });

  it("编辑 action 忽略伪造的 visibility 字段", async () => {
    const formData = new FormData();
    formData.set("name", "private-a");
    formData.set("catalogId", "catalog-chat");
    formData.set("visibility", "public");

    await updateMyModel("private-a", formData);

    expect(mockData.models.find((model) => model.id === "private-a")?.visibility).toBe("private");
  });
});

describe("checkMyProviderHealth", () => {
  it("全 network 失败 -> networkOk false, keyResults 全无效", async () => {
    mockData.providers = [{
      id: "p-a", ownerUserId: "admin-a", apiKeysEnc: "enc",
      protocol: "openai", baseUrl: "https://a",
      lastNetworkOk: null, lastKeyResults: null,
    }];
    vi.mocked(parseKeyBundle).mockReturnValue([
      { key: "k1", weight: 1 },
      { key: "k2", weight: 1 },
    ]);
    vi.mocked(probeProviderKey)
      .mockResolvedValueOnce({ ok: false, errorKind: "network", error: "fetch failed" })
      .mockResolvedValueOnce({ ok: false, errorKind: "network", error: "timeout" });

    const r = await checkMyProviderHealth("p-a");

    expect(r.networkOk).toBe(false);
    expect(r.healthy).toBe(0);
    expect(r.total).toBe(2);
    expect(r.keyResults).toHaveLength(2);
    expect(r.keyResults[0]).toMatchObject({ index: 0, ok: false, errorKind: "network" });
    expect(mockData.providers[0].lastNetworkOk).toBe(false);
    expect(mockData.providers[0].lastKeyResults as unknown[]).toHaveLength(2);
  });

  it("有 ok/非 network -> networkOk true, healthy 计 ok 数", async () => {
    mockData.providers = [{
      id: "p-b", ownerUserId: "admin-a", apiKeysEnc: "enc",
      protocol: "openai", baseUrl: "https://b",
      lastNetworkOk: null, lastKeyResults: null,
    }];
    vi.mocked(parseKeyBundle).mockReturnValue([
      { key: "k1", weight: 1 },
      { key: "k2", weight: 1 },
      { key: "k3", weight: 1 },
    ]);
    vi.mocked(probeProviderKey)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, errorKind: "auth", error: "401" })
      .mockResolvedValueOnce({ ok: false, errorKind: "unknown", error: "500" });

    const r = await checkMyProviderHealth("p-b");

    expect(r.networkOk).toBe(true);
    expect(r.healthy).toBe(1);
    expect(r.total).toBe(3);
    expect(mockData.providers[0].lastNetworkOk).toBe(true);
  });

  it("全 auth 失败也 networkOk true(能连上服务器)", async () => {
    mockData.providers = [{
      id: "p-c", ownerUserId: "admin-a", apiKeysEnc: "enc",
      protocol: "openai", baseUrl: "https://c",
      lastNetworkOk: null, lastKeyResults: null,
    }];
    vi.mocked(parseKeyBundle).mockReturnValue([{ key: "k1", weight: 1 }]);
    vi.mocked(probeProviderKey).mockResolvedValue({ ok: false, errorKind: "auth", error: "401" });

    const r = await checkMyProviderHealth("p-c");

    expect(r.networkOk).toBe(true);
    expect(r.healthy).toBe(0);
  });

  it("存活检测失败 + 有 testModel -> 回退深度检测,成功则 key 标 ok + 更新两处结果", async () => {
    mockData.providers = [{
      id: "p-d", ownerUserId: "admin-a", apiKeysEnc: "enc",
      protocol: "openai", baseUrl: "https://d", testModel: "claude-fable-5",
      lastNetworkOk: null, lastKeyResults: null,
    }];
    vi.mocked(parseKeyBundle).mockReturnValue([{ key: "k1", weight: 1 }]);
    // 存活检测(空 body)返 unknown(opencode 伪 401),回退深度检测(带 model)返 ok
    vi.mocked(probeProviderKey)
      .mockResolvedValueOnce({ ok: false, errorKind: "unknown", error: "伪 401" })
      .mockResolvedValueOnce({ ok: true, latencyMs: 50 });

    const r = await checkMyProviderHealth("p-d");

    expect(r.healthy).toBe(1);
    expect(r.networkOk).toBe(true);
    expect(r.keyResults[0]).toMatchObject({ index: 0, ok: true });
    expect(mockData.providers[0].lastModelProbeOk).toBe(true);
    expect(vi.mocked(probeProviderKey).mock.calls[1][0]).toMatchObject({ upstreamModelName: "claude-fable-5" });
  });
});

describe("testMyProviderModel", () => {
  it("未配置 testModel -> ok false, 不调 probe", async () => {
    mockData.providers = [{
      id: "p-a", ownerUserId: "admin-a", apiKeysEnc: "enc",
      protocol: "openai", baseUrl: "https://a", testModel: null,
    }];
    vi.mocked(probeProviderKey).mockReset();

    const r = await testMyProviderModel("p-a");

    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("unknown");
    expect(vi.mocked(probeProviderKey)).not.toHaveBeenCalled();
  });

  it("配了 testModel -> 用 testModel 调 probeProviderKey, 落库 ok", async () => {
    mockData.providers = [{
      id: "p-b", ownerUserId: "admin-a", apiKeysEnc: "enc",
      protocol: "openai", baseUrl: "https://b", testModel: "claude-fable-5",
    }];
    vi.mocked(parseKeyBundle).mockReturnValue([{ key: "k1", weight: 1 }]);
    vi.mocked(pickWeightedKey).mockReturnValue("k1");
    vi.mocked(probeProviderKey).mockResolvedValue({ ok: true, latencyMs: 50 });

    const r = await testMyProviderModel("p-b");

    expect(r.ok).toBe(true);
    expect(vi.mocked(probeProviderKey)).toHaveBeenCalledWith(expect.objectContaining({
      upstreamModelName: "claude-fable-5",
      apiKey: "k1",
    }));
    expect(mockData.providers[0].lastModelProbeOk).toBe(true);
    expect(mockData.providers[0].lastModelProbeError).toBeNull();
  });
});

describe("testMyKeyDirect", () => {
  beforeEach(() => {
    vi.mocked(probeProviderKey).mockReset();
  });

  it("无 testModel -> 不带 upstreamModelName(空 body 验 key)", async () => {
    vi.mocked(probeProviderKey).mockResolvedValue({ ok: true, latencyMs: 30 });

    const r = await testMyKeyDirect({
      protocol: "openai",
      baseUrl: "https://a",
      apiKey: "k1",
    });

    expect(r.ok).toBe(true);
    const callArg = vi.mocked(probeProviderKey).mock.calls[0][0];
    expect(callArg.upstreamModelName).toBeFalsy();
  });

  it("有 testModel -> 带 upstreamModelName 走深度检测", async () => {
    vi.mocked(probeProviderKey).mockResolvedValue({ ok: true, latencyMs: 50 });

    const r = await testMyKeyDirect({
      protocol: "openai",
      baseUrl: "https://a",
      apiKey: "k1",
      testModel: "claude-fable-5",
    });

    expect(r.ok).toBe(true);
    const callArg = vi.mocked(probeProviderKey).mock.calls[0][0];
    expect(callArg.upstreamModelName).toBe("claude-fable-5");
  });
});
