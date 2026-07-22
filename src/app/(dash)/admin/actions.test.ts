import { beforeEach, describe, expect, it, vi } from "vitest";

const mockData = vi.hoisted(() => ({
  admin: { id: "admin-a", role: "admin" },
  models: [] as Record<string, unknown>[],
  providers: [] as Record<string, unknown>[],
  routes: [] as Record<string, unknown>[],
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
  parseKeyBundle: vi.fn(),
  pickWeightedKey: vi.fn(),
}));
vi.mock("@/lib/providers/probe", () => ({ probeProviderKey: vi.fn(), fetchUpstreamModels: vi.fn() }));
vi.mock("@/lib/circuit-breaker", () => ({ recordSuccess: vi.fn(), recordFailure: vi.fn() }));

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
    },
    providers: {
      __table: "providers",
      id: "id",
      ownerUserId: "ownerUserId",
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
        const rows = table.__table === "providers"
          ? mockData.providers
          : table.__table === "routes"
            ? mockData.routes
            : mockData.models;
        return makeQuery(rows, fields);
      },
    }),
    insert: (table: { __table?: string }) => ({
      values: async (row: Record<string, unknown>) => {
        if (table.__table === "routes") {
          mockData.routes.push({ id: `route-${mockData.routes.length + 1}`, ...row });
        }
      },
    }),
  };

  return { getDb: async () => db, getSchema: () => schema };
});

import { attachProviderModelRoute } from "./actions";

beforeEach(() => {
  mockData.models = [
    { id: "private-a", ownerUserId: "admin-a", visibility: "private" },
    { id: "private-b", ownerUserId: "user-b", visibility: "private" },
    { id: "public-b", ownerUserId: "user-b", visibility: "public" },
  ];
  mockData.providers = [{ id: "provider-a", ownerUserId: "admin-a" }];
  mockData.routes = [];
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
