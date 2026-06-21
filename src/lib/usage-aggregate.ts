/**
 * 用量聚合查询 —— 供 admin 图表使用。
 *
 * dialect 差异(PG date_trunc / SQLite strftime)在此封装,业务层不感知。
 * 时间桶粒度:hour(24h 范围)/ day(7d/30d 范围)。
 */
import { sql, and, gte } from "drizzle-orm";
import { getDb, getSchema, isPg } from "@/lib/infra/db";

export type TimeRange = "24h" | "7d" | "30d";

export interface TimeSeriesPoint {
  bucket: string; // ISO-like 桶标识(2026-06-19 或 2026-06-19 14:00)
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export interface ModelBreakdownRow {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export interface SourceBreakdownRow {
  source: string;
  calls: number;
}

/** 范围 → 起始时间戳(Date)。 */
function rangeStart(range: TimeRange): Date {
  const now = Date.now();
  const ms = range === "24h" ? 24 : range === "7d" ? 168 : 720; // 小时
  return new Date(now - ms * 3600_000);
}

/** dialect-aware 时间桶表达式(返回列名 "bucket")。 */
function bucketExpr(range: TimeRange): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const col = s.usageLogs.createdAt;
  // PG: date_trunc('hour'|'day', ts) —— SQLite: strftime('%Y-%m-%d %H:00'|'%Y-%m-%d', ts, 'unixepoch')
  if (isPg) {
    const unit = range === "24h" ? "hour" : "day";
    return sql`date_trunc(${unit}, ${col})`.as("bucket");
  }
  const fmt = range === "24h" ? "%Y-%m-%d %H:00" : "%Y-%m-%d";
  return sql`strftime(${fmt}, ${col}, 'unixepoch')`.as("bucket");
}

/** 时间序列(按桶聚合 calls + tokens)。 */
export async function getTimeSeries(range: TimeRange): Promise<TimeSeriesPoint[]> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const start = rangeStart(range);

  const rows = await db
    .select({
      bucket: bucketExpr(range),
      calls: sql<number>`count(*)`,
      promptTokens: sql<number>`coalesce(sum(${s.usageLogs.promptTokens}),0)`,
      completionTokens: sql<number>`coalesce(sum(${s.usageLogs.completionTokens}),0)`,
    })
    .from(s.usageLogs)
    .where(gte(s.usageLogs.createdAt, start))
    .groupBy(sql`bucket`)
    .orderBy(sql`bucket`);

  return (rows as Record<string, unknown>[]).map((r) => ({
    bucket: String(r.bucket),
    calls: Number(r.calls),
    promptTokens: Number(r.promptTokens),
    completionTokens: Number(r.completionTokens),
  }));
}

/** 模型分布(范围内)。 */
export async function getModelBreakdown(range: TimeRange): Promise<ModelBreakdownRow[]> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const start = rangeStart(range);

  const rows = await db
    .select({
      model: s.usageLogs.model,
      calls: sql<number>`count(*)`,
      promptTokens: sql<number>`coalesce(sum(${s.usageLogs.promptTokens}),0)`,
      completionTokens: sql<number>`coalesce(sum(${s.usageLogs.completionTokens}),0)`,
    })
    .from(s.usageLogs)
    .where(gte(s.usageLogs.createdAt, start))
    .groupBy(s.usageLogs.model)
    .orderBy(sql`count(*) DESC`);

  return (rows as Record<string, unknown>[]).map((r) => ({
    model: String(r.model),
    calls: Number(r.calls),
    promptTokens: Number(r.promptTokens),
    completionTokens: Number(r.completionTokens),
  }));
}

/** 来源分布(chat vs gateway)。 */
export async function getSourceBreakdown(range: TimeRange): Promise<SourceBreakdownRow[]> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const start = rangeStart(range);

  const rows = await db
    .select({
      source: s.usageLogs.source,
      calls: sql<number>`count(*)`,
    })
    .from(s.usageLogs)
    .where(and(gte(s.usageLogs.createdAt, start)))
    .groupBy(s.usageLogs.source)
    .orderBy(sql`count(*) DESC`);

  return (rows as Record<string, unknown>[]).map((r) => ({
    source: String(r.source),
    calls: Number(r.calls),
  }));
}
