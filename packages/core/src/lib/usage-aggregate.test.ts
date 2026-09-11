import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgTable, text, timestamp, integer, PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), getSchema: vi.fn(), where: vi.fn() }));
vi.mock("./infra/db/index", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));
import { getTimeSeries, getModelBreakdown, getSourceBreakdown, listUsageLogs } from "./usage-aggregate";

const executions = pgTable("gateway_executions", {
  createdAt: timestamp("created_at", { withTimezone: true }),
  status: text("status"), userId: text("user_id"), model: text("model"), source: text("source"),
  promptTokens: integer("prompt_tokens"), completionTokens: integer("completion_tokens"),
  apiKeyId: text("api_key_id"), providerName: text("provider_name"), routeName: text("route_name"),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSchema.mockReturnValue({ gatewayExecutions: executions });
  const query = {
    from: () => query,
    where: mocks.where.mockImplementation(() => query),
    groupBy: () => query,
    orderBy: async () => [],
  };
  mocks.getDb.mockResolvedValue({ select: () => query });
});

describe.each([getTimeSeries, getModelBreakdown, getSourceBreakdown])("图表时间边界 %s", (query) => {
  it("使用所选日期的上下界，并保留用户隔离与成功状态", async () => {
    const startAt = new Date("2026-08-01T00:00:00Z");
    const endAt = new Date("2026-08-02T00:00:00Z");
    await query("24h", "user-1", { startAt, endAt });
    const sql = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0] as SQL);
    expect(sql.params).toEqual(["success", "user-1", startAt.toISOString(), endAt.toISOString()]);
    expect(sql.sql).toContain('"created_at" >=');
    expect(sql.sql).toContain('"created_at" <=');
  });

  it("只给结束日期时不偷偷补最近七天的起始边界", async () => {
    const endAt = new Date("2026-08-02T00:00:00Z");
    await query("7d", "user-1", { endAt });
    const sql = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0] as SQL);
    expect(sql.params).toEqual(["success", "user-1", endAt.toISOString()]);
    expect(sql.sql).not.toContain('"created_at" >=');
  });
});

it.each([
  { query: getTimeSeries, row: { bucket: "2026-09-11", calls: "2", promptTokens: "3", completionTokens: "4" }, expected: { bucket: "2026-09-11", calls: 2, promptTokens: 3, completionTokens: 4 } },
  { query: getModelBreakdown, row: { model: "model", calls: "2", promptTokens: "3", completionTokens: "4" }, expected: { model: "model", calls: 2, promptTokens: 3, completionTokens: 4 } },
  { query: getSourceBreakdown, row: { source: "chat", calls: "2" }, expected: { source: "chat", calls: 2 } },
])("聚合数值保留运行时转换 $row", async ({ query: load, row, expected }) => {
  const query = { from: () => query, where: () => query, groupBy: () => query, orderBy: async () => [row] };
  mocks.getDb.mockResolvedValue({ select: () => query });
  expect(await load("24h")).toEqual([expected]);
});

it("分页与 count 共享完整过滤，保留数值和可空关联投影", async () => {
  const apiKeys = pgTable("api_keys", { id: text("id"), name: text("name") });
  const user = pgTable("user", { id: text("id"), name: text("name"), email: text("email") });
  mocks.getSchema.mockReturnValue({ gatewayExecutions: executions, apiKeys, user });
  const createdAt = new Date("2026-09-11T00:00:00Z");
  const rows = [{ row: { id: "execution", source: "chat", model: "model", promptTokens: "12", completionTokens: null, createdAt }, apiKeyName: null }];
  const offset = vi.fn(async () => rows);
  const limit = vi.fn(() => ({ offset }));
  const list = {
    from: () => list, leftJoin: () => list,
    where: vi.fn<(condition: SQL | undefined) => unknown>().mockReturnThis(), orderBy: () => ({ limit }),
  };
  const count = { from: () => count, where: vi.fn<(condition: SQL | undefined) => Promise<{ count: string }[]>>(async () => [{ count: "7" }]) };
  mocks.getDb.mockResolvedValue({ select: vi.fn().mockReturnValueOnce(list).mockReturnValueOnce(count) });
  const result = await listUsageLogs({
    page: 2, pageSize: 3, userId: "owner",
    filters: { model: "model", providerName: "provider", routeName: "route", startAt: createdAt },
  });
  expect(count.where).toHaveBeenCalledWith(list.where.mock.calls[0][0]);
  const sql = new PgDialect().sqlToQuery(list.where.mock.calls[0][0] as SQL);
  expect(sql.params).toEqual(["success", "owner", "model", "provider", "route", createdAt.toISOString()]);
  expect(limit).toHaveBeenCalledWith(3);
  expect(offset).toHaveBeenCalledWith(3);
  expect(result.total).toBe(7);
  expect(result.rows[0]).toMatchObject({ id: "execution", promptTokens: 12, completionTokens: 0, apiKeyName: null, userName: null, userEmail: null, reasoningLevel: null, createdAt });
});
