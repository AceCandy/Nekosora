/**
 * 用量聚合查询 —— 供 admin 图表使用。
 *
 * dialect 差异(PG date_trunc / SQLite strftime)在此封装,业务层不感知。
 * 时间桶粒度:hour(24h 范围)/ day(7d/30d 范围)。
 */
import { sql, and, gte, eq, desc, lte, type SQL } from "drizzle-orm";
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

/** 时间序列(按桶聚合 calls + tokens)。可选 userId 限定为某用户。 */
export async function getTimeSeries(range: TimeRange, userId?: string): Promise<TimeSeriesPoint[]> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const start = rangeStart(range);
  const conds = [gte(s.usageLogs.createdAt, start)];
  if (userId) conds.push(eq(s.usageLogs.userId, userId));

  const rows = await db
    .select({
      bucket: bucketExpr(range),
      calls: sql<number>`count(*)`,
      promptTokens: sql<number>`coalesce(sum(${s.usageLogs.promptTokens}),0)`,
      completionTokens: sql<number>`coalesce(sum(${s.usageLogs.completionTokens}),0)`,
    })
    .from(s.usageLogs)
    .where(and(...conds))
    .groupBy(sql`bucket`)
    .orderBy(sql`bucket`);

  return (rows as Record<string, unknown>[]).map((r) => ({
    bucket: String(r.bucket),
    calls: Number(r.calls),
    promptTokens: Number(r.promptTokens),
    completionTokens: Number(r.completionTokens),
  }));
}

/** 模型分布(范围内)。可选 userId 限定为某用户。 */
export async function getModelBreakdown(range: TimeRange, userId?: string): Promise<ModelBreakdownRow[]> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const start = rangeStart(range);
  const conds = [gte(s.usageLogs.createdAt, start)];
  if (userId) conds.push(eq(s.usageLogs.userId, userId));

  const rows = await db
    .select({
      model: s.usageLogs.model,
      calls: sql<number>`count(*)`,
      promptTokens: sql<number>`coalesce(sum(${s.usageLogs.promptTokens}),0)`,
      completionTokens: sql<number>`coalesce(sum(${s.usageLogs.completionTokens}),0)`,
    })
    .from(s.usageLogs)
    .where(and(...conds))
    .groupBy(s.usageLogs.model)
    .orderBy(sql`count(*) DESC`);

  return (rows as Record<string, unknown>[]).map((r) => ({
    model: String(r.model),
    calls: Number(r.calls),
    promptTokens: Number(r.promptTokens),
    completionTokens: Number(r.completionTokens),
  }));
}

/** 来源分布(chat vs gateway)。可选 userId 限定为某用户。 */
export async function getSourceBreakdown(range: TimeRange, userId?: string): Promise<SourceBreakdownRow[]> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const start = rangeStart(range);
  const conds = [gte(s.usageLogs.createdAt, start)];
  if (userId) conds.push(eq(s.usageLogs.userId, userId));

  const rows = await db
    .select({
      source: s.usageLogs.source,
      calls: sql<number>`count(*)`,
    })
    .from(s.usageLogs)
    .where(and(...conds))
    .groupBy(s.usageLogs.source)
    .orderBy(sql`count(*) DESC`);

  return (rows as Record<string, unknown>[]).map((r) => ({
    source: String(r.source),
    calls: Number(r.calls),
  }));
}

// ===========================================================================
// 用量明细分页查询(Phase 4):替换 admin/usage/page.tsx 写死的 limit(20),
// 供 Phase 5 前端双 Tab 的「用量明细」调用。userId 隔离语义同 error-log-repository。
// ===========================================================================

/** 用量明细行 DTO(成功计费行,含路由可读信息快照)。 */
export interface UsageLogRow {
  id: string;
  source: string;
  userId: string | null;
  apiKeyId: string | null;
  keyKind: string | null;
  model: string;
  providerRef: string | null;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  latencyMs: number | null;
  status: string;
  firstTokenLatencyMs: number | null;
  providerName: string | null;
  routeId: string | null;
  routeName: string | null;
  upstreamModel: string | null;
  /** 命中的对外网关 key 名(LEFT JOIN apiKeys.name;chat 无 apiKeyId 时为 null)。 */
  apiKeyName: string | null;
  /** 命中上游 key 的脱敏快照(前3后3,中间 *)。 */
  upstreamKeyMasked: string | null;
  createdAt: Date;
}

/** 用量明细过滤项(全部可选,精确匹配)。 */
export interface UsageLogFilters {
  model?: string;
  providerName?: string;
  routeName?: string;
  source?: string;
  startAt?: Date;
  endAt?: Date;
}

export interface ListUsageLogsOptions {
  page: number;
  pageSize: number;
  /** 用户隔离(panel 必传;admin 不传)。 */
  userId?: string;
  filters?: UsageLogFilters;
}

export interface ListUsageLogsResult {
  rows: UsageLogRow[];
  total: number;
}

/** 组装 where 条件(list 与 count 复用)。 */
function buildUsageWhere(opts: ListUsageLogsOptions): SQL | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const t = s.usageLogs;
  const conds: SQL[] = [];
  if (opts.userId) conds.push(eq(t.userId, opts.userId));
  const f = opts.filters;
  if (f) {
    if (f.model) conds.push(eq(t.model, f.model));
    if (f.providerName) conds.push(eq(t.providerName, f.providerName));
    if (f.routeName) conds.push(eq(t.routeName, f.routeName));
    if (f.source) conds.push(eq(t.source, f.source));
    if (f.startAt) conds.push(gte(t.createdAt, f.startAt));
    if (f.endAt) conds.push(lte(t.createdAt, f.endAt));
  }
  return conds.length > 0 ? and(...conds) : undefined;
}

/** 把 drizzle 原始行收敛为 UsageLogRow DTO。apiKeyName 来自 LEFT JOIN apiKeys。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toUsageRow(r: any, apiKeyName: string | null = null): UsageLogRow {
  return {
    id: String(r.id),
    source: String(r.source),
    userId: r.userId ?? null,
    apiKeyId: r.apiKeyId ?? null,
    keyKind: r.keyKind ?? null,
    model: String(r.model),
    providerRef: r.providerRef ?? null,
    promptTokens: Number(r.promptTokens ?? 0),
    completionTokens: Number(r.completionTokens ?? 0),
    cacheReadTokens: Number(r.cacheReadTokens ?? 0),
    cacheWriteTokens: Number(r.cacheWriteTokens ?? 0),
    reasoningTokens: Number(r.reasoningTokens ?? 0),
    latencyMs: r.latencyMs ?? null,
    status: String(r.status ?? "success"),
    firstTokenLatencyMs: r.firstTokenLatencyMs ?? null,
    providerName: r.providerName ?? null,
    routeId: r.routeId ?? null,
    routeName: r.routeName ?? null,
    upstreamModel: r.upstreamModel ?? null,
    apiKeyName,
    upstreamKeyMasked: r.upstreamKeyMasked ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
  };
}

/**
 * 分页查询用量明细(成功计费,按 createdAt desc)。
 * userId 传入时强制隔离(panel);不传时看全部(admin)。
 */
export async function listUsageLogs(
  opts: ListUsageLogsOptions,
): Promise<ListUsageLogsResult> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const t = s.usageLogs;
  const where = buildUsageWhere(opts);
  const page = Math.max(1, opts.page);
  const pageSize = Math.max(1, opts.pageSize);
  const offset = (page - 1) * pageSize;

  // LEFT JOIN apiKeys 取对外网关 key 的 name;cacheReadTokens 已在 usage_logs 列中。
  const [rowsRaw, countRows] = await Promise.all([
    db
      .select({ row: t, apiKeyName: s.apiKeys.name })
      .from(t)
      .leftJoin(s.apiKeys, eq(t.apiKeyId, s.apiKeys.id))
      .where(where)
      .orderBy(desc(t.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(t).where(where),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (rowsRaw as any[]).map(({ row, apiKeyName }) =>
    toUsageRow(row, apiKeyName ?? null),
  );
  return { rows, total: Number(countRows[0]?.count ?? 0) };
}
