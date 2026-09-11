import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgTable, text, timestamp, integer, PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), getSchema: vi.fn(), where: vi.fn() }));
vi.mock("./infra/db/index", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));
import { getTimeSeries, getModelBreakdown, getSourceBreakdown } from "./usage-aggregate";

const executions = pgTable("gateway_executions", {
  createdAt: timestamp("created_at", { withTimezone: true }),
  status: text("status"), userId: text("user_id"), model: text("model"), source: text("source"),
  promptTokens: integer("prompt_tokens"), completionTokens: integer("completion_tokens"),
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
