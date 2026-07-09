/**
 * 用量聚合查询 —— 供 admin 图表使用。
 *
 * dialect 差异(PG date_trunc / SQLite strftime)在此封装,业务层不感知。
 * 时间桶粒度:hour(24h 范围)/ day(7d/30d 范围)。
 */
import { sql, and, gte, eq, desc, lte, isNotNull, ilike, like, or, type SQL } from "drizzle-orm";
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
  /** 用户名(LEFT JOIN user.name;admin 用户列展示)。 */
  userName: string | null;
  /** 用户邮箱(LEFT JOIN user.email;admin 用户列展示)。 */
  userEmail: string | null;
  createdAt: Date;
}

/** 用量明细过滤项(全部可选,精确匹配)。 */
export interface UsageLogFilters {
  model?: string;
  providerName?: string;
  routeName?: string;
  source?: string;
  /** admin 筛选用(区别于 opts.userId 的 panel 隔离语义)。 */
  userId?: string;
  /** 命中的对外网关 key id(密钥筛选)。 */
  apiKeyId?: string;
  /** 命中的上游 key 脱敏快照(上游key 筛选)。 */
  upstreamKeyMasked?: string;
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
    if (f.userId) conds.push(eq(t.userId, f.userId));
    if (f.apiKeyId) conds.push(eq(t.apiKeyId, f.apiKeyId));
    if (f.upstreamKeyMasked) conds.push(eq(t.upstreamKeyMasked, f.upstreamKeyMasked));
    if (f.startAt) conds.push(gte(t.createdAt, f.startAt));
    if (f.endAt) conds.push(lte(t.createdAt, f.endAt));
  }
  return conds.length > 0 ? and(...conds) : undefined;
}

/** 把 drizzle 原始行收敛为 UsageLogRow DTO。apiKeyName 来自 LEFT JOIN apiKeys。 */
function toUsageRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  r: any,
  meta: { apiKeyName?: string | null; userName?: string | null; userEmail?: string | null } = {},
): UsageLogRow {
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
    apiKeyName: meta.apiKeyName ?? null,
    upstreamKeyMasked: r.upstreamKeyMasked ?? null,
    userName: meta.userName ?? null,
    userEmail: meta.userEmail ?? null,
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

  // LEFT JOIN apiKeys(对外网关 key 名)+ user(用户名/邮箱,admin 用户列展示)。
  const [rowsRaw, countRows] = await Promise.all([
    db
      .select({ row: t, apiKeyName: s.apiKeys.name, userName: s.user.name, userEmail: s.user.email })
      .from(t)
      .leftJoin(s.apiKeys, eq(t.apiKeyId, s.apiKeys.id))
      .leftJoin(s.user, eq(t.userId, s.user.id))
      .where(where)
      .orderBy(desc(t.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(t).where(where),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (rowsRaw as any[]).map(({ row, apiKeyName, userName, userEmail }) =>
    toUsageRow(row, { apiKeyName, userName, userEmail }),
  );
  return { rows, total: Number(countRows[0]?.count ?? 0) };
}

// ===========================================================================
// 筛选候选项拉取(R2):distinct model/providerName/routeName + 用户(admin)。
// userId 传入(panel)→ 仅该用户自己的候选 + users 空(panel 无用户筛选);
// userId 不传(admin)→ 全量候选 + users(distinct userId JOIN user)。
// ===========================================================================

/** 筛选下拉候选项(模型/服务商/路由/用户)。 */
export interface UsageFilterOptions {
  models: string[];
  providers: string[];
  routes: string[];
  /** 有日志记录的用户(admin 用户筛选下拉;panel 返回空)。 */
  users: { id: string; name: string; email: string }[];
}

/**
 * 拉取筛选下拉候选项(distinct,限 100)。
 * - models: distinct model(notNull)
 * - providers/routes: distinct providerName/routeName(可空,过滤 null)
 * - users: distinct userId JOIN user(仅 admin;panel 传 userId → 返回 [])
 */
export async function listUsageFilterOptions(userId?: string): Promise<UsageFilterOptions> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const t = s.usageLogs;
  const userCond = userId ? eq(t.userId, userId) : undefined;

  const [modelRows, providerRows, routeRows] = await Promise.all([
    db.selectDistinct({ v: t.model }).from(t).where(userCond).orderBy(t.model).limit(100),
    db
      .selectDistinct({ v: t.providerName })
      .from(t)
      .where(and(userCond, isNotNull(t.providerName)))
      .orderBy(t.providerName)
      .limit(100),
    db
      .selectDistinct({ v: t.routeName })
      .from(t)
      .where(and(userCond, isNotNull(t.routeName)))
      .orderBy(t.routeName)
      .limit(100),
  ]);

  // users 仅 admin(panel 传 userId → 空,无需查)。
  const userRows = userId
    ? []
    : await db
        .selectDistinct({ id: t.userId, name: s.user.name, email: s.user.email })
        .from(t)
        .leftJoin(s.user, eq(t.userId, s.user.id))
        .where(isNotNull(t.userId))
        .limit(100);

  const users = (userRows as { id: string | null; name: string | null; email: string | null }[])
    .filter((u) => u.id)
    .map((u) => ({ id: String(u.id), name: String(u.name ?? ""), email: String(u.email ?? "") }));
  return {
    models: (modelRows as { v: string | null }[]).map((r) => String(r.v ?? "")).filter(Boolean),
    providers: (providerRows as { v: string | null }[]).map((r) => (r.v ? String(r.v) : "")).filter(Boolean),
    routes: (routeRows as { v: string | null }[]).map((r) => (r.v ? String(r.v) : "")).filter(Boolean),
    users,
  };
}

// ===========================================================================
// typeahead 候选搜索(迭代 v2):Combobox 输入时调用,支持级联 filter。
// distinct + 大小写不敏感 LIKE + 按 userId/providerName 过滤。限 30。
// ===========================================================================

export type UsageCandidateType = "users" | "keys" | "providers" | "models" | "upstreamKeys";

export interface UsageCandidate {
  id: string;
  label: string;
  sub?: string;
}

export interface SearchUsageCandidatesOpts {
  type: UsageCandidateType;
  q?: string;
  /** 级联:已选用户(panel 固定自己;admin 可跨用户)。 */
  userId?: string;
  /** 级联:已选服务商(模型/上游key 按 userId+providerName 过滤)。 */
  providerName?: string;
  limit?: number;
}

/** 大小写不敏感 LIKE(pg ilike / sqlite like 默认 ASCII 不敏感)。 */
function iLike(col: SQL, q: string): SQL {
  return isPg ? ilike(col, `%${q}%`) : like(col, `%${q}%`);
}

/**
 * typeahead 候选搜索。按 type 返回不同维度候选,支持关键词 q 模糊 + 级联 filter。
 * - users(admin):distinct userId JOIN user,q 匹配 name/email
 * - keys:distinct apiKeyId JOIN apiKeys,q 匹配 name,按 userId 过滤
 * - providers:distinct providerName,q like,按 userId 过滤
 * - models:distinct model,q like,按 userId+providerName 过滤
 * - upstreamKeys:distinct upstreamKeyMasked,q like,按 userId+providerName 过滤
 */
export async function searchUsageCandidates(opts: SearchUsageCandidatesOpts): Promise<UsageCandidate[]> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const t = s.usageLogs;
  const limit = Math.min(opts.limit ?? 30, 50);
  const q = opts.q?.trim();
  const userCond = opts.userId ? eq(t.userId, opts.userId) : undefined;
  const providerCond = opts.providerName ? eq(t.providerName, opts.providerName) : undefined;

  if (opts.type === "users") {
    const rows = (await db
      .selectDistinct({ id: t.userId, name: s.user.name, email: s.user.email })
      .from(t)
      .leftJoin(s.user, eq(t.userId, s.user.id))
      .where(and(isNotNull(t.userId), q ? or(iLike(s.user.name, q), iLike(s.user.email, q)) : undefined))
      .limit(limit)) as { id: string | null; name: string | null; email: string | null }[];
    return rows
      .filter((u) => u.id)
      .map((u) => ({ id: String(u.id), label: String(u.name || u.email || u.id), sub: u.email ?? undefined }));
  }
  if (opts.type === "keys") {
    const rows = (await db
      .selectDistinct({ id: t.apiKeyId, name: s.apiKeys.name })
      .from(t)
      .leftJoin(s.apiKeys, eq(t.apiKeyId, s.apiKeys.id))
      .where(and(isNotNull(t.apiKeyId), userCond, q ? iLike(s.apiKeys.name, q) : undefined))
      .limit(limit)) as { id: string | null; name: string | null }[];
    return rows.filter((r) => r.id).map((r) => ({ id: String(r.id), label: String(r.name ?? r.id) }));
  }
  if (opts.type === "providers") {
    const rows = (await db
      .selectDistinct({ v: t.providerName })
      .from(t)
      .where(and(isNotNull(t.providerName), userCond, q ? iLike(t.providerName, q) : undefined))
      .orderBy(t.providerName)
      .limit(limit)) as { v: string | null }[];
    return rows.map((r) => r.v).filter(Boolean).map((v) => ({ id: v as string, label: v as string }));
  }
  if (opts.type === "models") {
    const rows = (await db
      .selectDistinct({ v: t.model })
      .from(t)
      .where(and(userCond, providerCond, q ? iLike(t.model, q) : undefined))
      .orderBy(t.model)
      .limit(limit)) as { v: string | null }[];
    return rows.map((r) => r.v).filter(Boolean).map((v) => ({ id: v as string, label: v as string }));
  }
  // upstreamKeys
  const rows = (await db
    .selectDistinct({ v: t.upstreamKeyMasked })
    .from(t)
    .where(and(isNotNull(t.upstreamKeyMasked), userCond, providerCond, q ? iLike(t.upstreamKeyMasked, q) : undefined))
    .orderBy(t.upstreamKeyMasked)
    .limit(limit)) as { v: string | null }[];
  return rows.map((r) => r.v).filter(Boolean).map((v) => ({ id: v as string, label: v as string }));
}
