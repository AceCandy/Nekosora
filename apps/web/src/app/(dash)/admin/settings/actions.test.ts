import { beforeEach, describe, expect, it, vi } from "vitest";

const mockData = vi.hoisted(() => ({
  admin: { id: "admin-a", role: "admin" },
  providers: [] as Record<string, unknown>[],
  systemSettings: [] as Record<string, unknown>[],
  providerSelectCount: 0,
}));

const mockFunctions = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  stageSystemSettings: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, value: unknown) => ({ type: "eq", col, value }),
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
}));

vi.mock("next/cache", () => ({ revalidatePath: mockFunctions.revalidatePath }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn(async () => mockData.admin) }));
vi.mock("@/lib/settings-control/service", () => ({
  stageSystemSettings: mockFunctions.stageSystemSettings,
}));

vi.mock("@/lib/infra/db", () => {
  type Condition =
    | { type: "eq"; col: string; value: unknown }
    | { type: "and"; conditions: Condition[] };

  function matches(row: Record<string, unknown>, condition: Condition | undefined): boolean {
    if (!condition) return true;
    if (condition.type === "eq") return row[condition.col] === condition.value;
    return condition.conditions.every((item) => matches(row, item));
  }

  function makeQuery(rows: Record<string, unknown>[], fields?: Record<string, unknown>) {
    return {
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
  }

  const schema = {
    providers: {
      __table: "providers",
      id: "id",
      ownerUserId: "ownerUserId",
    },
    systemSettings: {
      __table: "systemSettings",
      id: "id",
      namespace: "namespace",
      key: "key",
      value: "value",
      updatedAt: "updatedAt",
    },
  };

  function rowsForTable(table: { __table?: string }) {
    return table.__table === "providers" ? mockData.providers : mockData.systemSettings;
  }

  const db = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: { __table?: string }) => {
        if (table.__table === "providers") mockData.providerSelectCount += 1;
        return makeQuery(rowsForTable(table), fields);
      },
    }),
    insert: (table: { __table?: string }) => ({
      values: async (row: Record<string, unknown>) => {
        rowsForTable(table).push({ id: `setting-${mockData.systemSettings.length + 1}`, ...row });
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
    delete: (table: { __table?: string }) => ({
      where: async (condition: Condition) => {
        const rows = rowsForTable(table);
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (matches(rows[index], condition)) rows.splice(index, 1);
        }
      },
    }),
  };

  return { getDb: async () => db, getSchema: () => schema };
});

import { saveEmbedding } from "./actions";

const EXPECTED = { changeSetId: null, version: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockData.providers = [{ id: "provider-b", ownerUserId: "admin-b" }];
  mockData.systemSettings = [
    { id: "setting-provider", namespace: "rag", key: "embedding_provider_id", value: "provider-a" },
    { id: "setting-model", namespace: "rag", key: "embedding_model", value: "model-a" },
  ];
  mockData.providerSelectCount = 0;
});

describe("saveEmbedding", () => {
  it("保存自己的服务商并规范化模型名", async () => {
    mockData.providers = [{ id: "provider-a", ownerUserId: "admin-a" }];
    const formData = new FormData();
    formData.set("provider_id", "provider-a");
    formData.set("model", "  model-new  ");

    await expect(saveEmbedding(EXPECTED, formData)).resolves.toBeUndefined();
    expect(mockFunctions.stageSystemSettings).toHaveBeenCalledWith({
      actorId: "admin-a",
      expected: EXPECTED,
      namespace: "rag",
      values: { embedding_provider_id: "provider-a", embedding_model: "model-new" },
    });
    expect(mockData.providerSelectCount).toBe(1);
    expect(mockFunctions.revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });

  it("拒绝使用其他管理员的服务商并保留原配置", async () => {
    const formData = new FormData();
    formData.set("provider_id", "provider-b");
    formData.set("model", "model-b");

    await expect(saveEmbedding(EXPECTED, formData)).rejects.toThrow("服务商不存在");
    expect(mockData.providerSelectCount).toBe(1);
    expect(mockFunctions.stageSystemSettings).not.toHaveBeenCalled();
    expect(mockFunctions.revalidatePath).not.toHaveBeenCalled();
  });

  it("拒绝不存在的服务商并使用相同错误", async () => {
    const formData = new FormData();
    formData.set("provider_id", "provider-missing");
    formData.set("model", "model-missing");

    await expect(saveEmbedding(EXPECTED, formData)).rejects.toThrow("服务商不存在");
    expect(mockData.providerSelectCount).toBe(1);
    expect(mockFunctions.stageSystemSettings).not.toHaveBeenCalled();
    expect(mockFunctions.revalidatePath).not.toHaveBeenCalled();
  });

  it("空服务商跳过属主查询并清空配置", async () => {
    const formData = new FormData();
    formData.set("provider_id", "");
    formData.set("model", "");

    await expect(saveEmbedding(EXPECTED, formData)).resolves.toBeUndefined();
    expect(mockData.providerSelectCount).toBe(0);
    expect(mockFunctions.stageSystemSettings).toHaveBeenCalledWith({
      actorId: "admin-a",
      expected: EXPECTED,
      namespace: "rag",
      values: { embedding_provider_id: "", embedding_model: "" },
    });
    expect(mockFunctions.revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });
});
