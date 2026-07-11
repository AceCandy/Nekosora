import { beforeEach, describe, expect, it, vi } from "vitest";

const mockData = vi.hoisted(() => ({
  models: [] as Record<string, unknown>[],
  catalogs: [{ id: "catalog-chat", canonicalModelId: "__generic_chat__", aliases: [], enabled: true }],
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
  };

  const db = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: { __table?: string }) =>
        makeQuery(table.__table === "modelCatalog" ? mockData.catalogs : mockData.models, fields),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: (condition: Condition) => {
          const apply = () => {
            let count = 0;
            for (const model of mockData.models) {
              if (matches(model, condition)) {
                Object.assign(model, patch);
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
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        mockData.models.push({ id: `model-${mockData.models.length + 1}`, ...row });
      },
    }),
    transaction: (callback: (tx: typeof db) => void) => {
      const result = callback(db);
      if (result instanceof Promise) throw new TypeError("Transaction function cannot return a promise");
      return result;
    },
  };

  return { getDb: async () => db, getSchema: () => schema, isPg: false };
});

import { createMyModel, reorderMyModels, updateMyModel } from "./actions";

beforeEach(() => {
  mockData.user = { id: "admin-a", role: "admin" };
  mockData.models = [
    { id: "public-a", name: "public-a", ownerUserId: "admin-a", visibility: "public", sortOrder: 0 },
    { id: "public-b", name: "public-b", ownerUserId: "admin-a", visibility: "public", sortOrder: 1 },
    { id: "private-a", name: "private-a", ownerUserId: "admin-a", visibility: "private", sortOrder: 5 },
    { id: "private-b", name: "private-b", ownerUserId: "user-b", visibility: "private", sortOrder: 2 },
  ];
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
