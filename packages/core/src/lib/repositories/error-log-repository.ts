/**
 * ErrorLogRepository —— 网关执行失败与 attempt chain 的查询访问层。
 *
 * 业务层(admin / panel 前端 + server actions)统一调用。
 * 鉴权隔离:任何按 userId 过滤的查询,userId 必填且强制 where,防越权。
 *   - admin 后台:不传 userId(看全部)
 *   - panel 用户端:必传 userId(只看自己的)
 */
import { eq, and, gte, lte, desc, sql, isNotNull, ilike, or, inArray, type SQL } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";

/** 错误请求明细行(DTO,服务边界收敛成显式类型供前端消费)。 */
export interface ErrorLogRow {
  id: string;
  requestId: string;
  source: string;
  userId: string | null;
  apiKeyId: string | null;
  keyKind: string | null;
  model: string;
  upstreamModel: string | null;
  providerName: string | null;
  providerRef: string | null;
  routeId: string | null;
  routeName: string | null;
  requestPath: string | null;
  stream: boolean;
  httpStatus: number | null;
  errorCode: string;
  errorMessage: string | null;
  errorPhase: string | null;
  errorType: string | null;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number | null;
  firstTokenLatencyMs: number | null;
  /** 命中的对外网关 key 名(LEFT JOIN apiKeys.name;chat 无 apiKeyId 时为 null)。 */
  apiKeyName: string | null;
  /** 命中上游 key 的脱敏快照(前3后3,中间 *)。 */
  upstreamKeyMasked: string | null;
  /** 用户名(LEFT JOIN user.name;admin 用户列展示)。 */
  userName: string | null;
  /** 用户邮箱(LEFT JOIN user.email;admin 用户列展示)。 */
  userEmail: string | null;
  /** 副任务类型(null=主回复/网关请求;title/memory/compact=后台副任务)。 */
  taskKind: string | null;
  /** 尝试序号(1..N);null=非尝试记录(中断)。同 requestId 按 attempt 升序即完整重试链。 */
  attempt: number | null;
  createdAt: Date;
}

/** 错误日志查询过滤项(全部可选,精确匹配)。 */
export interface ErrorLogFilters {
  /** 对外模型名(精确)。 */
  model?: string;
  /** 可读服务商名(精确)。 */
  providerName?: string;
  /** 路由展示名(精确)。 */
  routeName?: string;
  /** 错误生命周期阶段(routing/upstream/network/internal/auth/request)。 */
  errorPhase?: string;
  /** HTTP 状态码。 */
  httpStatus?: number;
  /** 调用来源(chat / gateway)。 */
  source?: string;
  /** admin 筛选用(区别于 opts.userId 的 panel 隔离语义)。 */
  userId?: string;
  /** 命中的对外网关 key id(密钥筛选)。 */
  apiKeyId?: string;
  /** 命中的上游 key 脱敏快照(上游key 筛选)。 */
  upstreamKeyMasked?: string;
  /** 起始时间(含,>= createdAt)。 */
  startAt?: Date;
  /** 截止时间(含,<= createdAt)。 */
  endAt?: Date;
  /** 排除某阶段(默认隐藏 auth 噪声用;与 errorPhase 互斥,errorPhase 优先)。 */
  excludeErrorPhase?: string;
}

export interface ListErrorLogsResult {
  rows: ErrorLogRow[];
  total: number;
}

export interface ListErrorLogsOptions {
  page: number;
  pageSize: number;
  /** 用户隔离:传入则强制按 userId 过滤(panel);不传则看全部(admin)。 */
  userId?: string;
  filters?: ErrorLogFilters;
}

/** 组装 where 条件(复用于 list 查询与 count 查询,保证二者一致)。 */
function buildWhere(opts: ListErrorLogsOptions): SQL | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const t = s.gatewayExecutions;
  const conds: SQL[] = [inArray(t.status, ["failed", "interrupted"])];
  // userId 隔离(panel 必传,admin 不传)。
  if (opts.userId) conds.push(eq(t.userId, opts.userId));

  const f = opts.filters;
  if (f) {
    if (f.model) conds.push(eq(t.model, f.model));
    if (f.providerName) conds.push(eq(t.providerName, f.providerName));
    if (f.routeName) conds.push(eq(t.routeName, f.routeName));
    if (f.errorPhase) conds.push(eq(t.errorPhase, f.errorPhase));
    else if (f.excludeErrorPhase) conds.push(sql`(${t.errorPhase} is null or ${t.errorPhase} != ${f.excludeErrorPhase})`);
    if (f.httpStatus !== undefined) conds.push(eq(t.httpStatus, f.httpStatus));
    if (f.source) conds.push(eq(t.source, f.source));
    if (f.userId) conds.push(eq(t.userId, f.userId));
    if (f.apiKeyId) conds.push(eq(t.apiKeyId, f.apiKeyId));
    if (f.upstreamKeyMasked) conds.push(eq(t.upstreamKeyMasked, f.upstreamKeyMasked));
    if (f.startAt) conds.push(gte(t.createdAt, f.startAt));
    if (f.endAt) conds.push(lte(t.createdAt, f.endAt));
  }
  return conds.length > 0 ? and(...conds) : undefined;
}

/** 把 attempt 与所属 execution 合并为现有错误日志 DTO。 */
function toAttemptRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attempt: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execution: any,
  meta: { apiKeyName?: string | null; userName?: string | null; userEmail?: string | null } = {},
): ErrorLogRow {
  return toRow({
    ...execution,
    id: attempt.id,
    upstreamModel: attempt.upstreamModel,
    providerName: attempt.providerName,
    providerRef: attempt.providerRef,
    routeId: attempt.routeId,
    routeName: attempt.routeName,
    upstreamKeyMasked: attempt.upstreamKeyMasked,
    httpStatus: attempt.httpStatus,
    errorCode: attempt.errorCode ?? execution.errorCode ?? "unknown",
    errorMessage: attempt.errorMessage ?? execution.errorMessage,
    errorPhase: attempt.errorPhase ?? execution.errorPhase,
    errorType: attempt.errorType ?? execution.errorType,
    promptTokens: attempt.promptTokens,
    completionTokens: attempt.completionTokens,
    latencyMs: attempt.latencyMs,
    firstTokenLatencyMs: attempt.firstTokenLatencyMs,
    attempt: attempt.attempt,
    createdAt: attempt.createdAt,
  }, meta);
}

/** 把 drizzle 原始行收敛为 ErrorLogRow DTO。apiKeyName 来自 LEFT JOIN apiKeys。 */
function toRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  r: any,
  meta: { apiKeyName?: string | null; userName?: string | null; userEmail?: string | null } = {},
): ErrorLogRow {
  return {
    id: String(r.id),
    requestId: String(r.requestId),
    source: String(r.source),
    userId: r.userId ?? null,
    apiKeyId: r.apiKeyId ?? null,
    keyKind: r.keyKind ?? null,
    model: String(r.model),
    upstreamModel: r.upstreamModel ?? null,
    providerName: r.providerName ?? null,
    providerRef: r.providerRef ?? null,
    routeId: r.routeId ?? null,
    routeName: r.routeName ?? null,
    requestPath: r.requestPath ?? null,
    stream: Boolean(r.stream),
    httpStatus: r.httpStatus ?? null,
    errorCode: String(r.errorCode),
    errorMessage: r.errorMessage ?? null,
    errorPhase: r.errorPhase ?? null,
    errorType: r.errorType ?? null,
    promptTokens: Number(r.promptTokens ?? 0),
    completionTokens: Number(r.completionTokens ?? 0),
    latencyMs: r.latencyMs ?? null,
    firstTokenLatencyMs: r.firstTokenLatencyMs ?? null,
    apiKeyName: meta.apiKeyName ?? null,
    upstreamKeyMasked: r.upstreamKeyMasked ?? null,
    userName: meta.userName ?? null,
    userEmail: meta.userEmail ?? null,
    taskKind: r.taskKind ?? null,
    attempt: r.attempt ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
  };
}

/**
 * 分页查询错误请求列表(按 createdAt desc)。
 * userId 传入时强制隔离(panel);不传时看全部(admin)。
 */
export async function listErrorLogs(
  opts: ListErrorLogsOptions,
): Promise<ListErrorLogsResult> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const t = s.gatewayExecutions;
  const where = buildWhere(opts);
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
    db
      .select({ count: sql<number>`count(*)` })
      .from(t)
      .where(where),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (rowsRaw as any[]).map(({ row, apiKeyName, userName, userEmail }) =>
    toRow(row, { apiKeyName, userName, userEmail }),
  );
  return { rows, total: Number(countRows[0]?.count ?? 0) };
}

/**
 * 查询单条错误请求详情。
 * userId 传入时强制隔离(防越权查他人记录);不传时 admin 可查任意。
 */
export async function getErrorLog(
  id: string,
  userId?: string,
): Promise<ErrorLogRow | null> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const t = s.gatewayExecutions;
  const conds: SQL[] = [eq(t.id, id), inArray(t.status, ["failed", "interrupted"])];
  if (userId) conds.push(eq(t.userId, userId));
  const [rowRaw] = await db
    .select({ row: t, apiKeyName: s.apiKeys.name, userName: s.user.name, userEmail: s.user.email })
    .from(t)
    .leftJoin(s.apiKeys, eq(t.apiKeyId, s.apiKeys.id))
    .leftJoin(s.user, eq(t.userId, s.user.id))
    .where(and(...conds))
    .limit(1);
  if (!rowRaw) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { row, apiKeyName, userName, userEmail } = rowRaw as any;
  return toRow(row, { apiKeyName, userName, userEmail });
}

/**
 * 批量查询多个 requestId 的全部错误尝试(供详情重试链展示)。
 *
 * attempt 通过 execution_id 关联逻辑请求。此方法按 requestId 聚合并按 attempt 升序，
 * userId 传入时强制在 execution 上隔离。
 */
export async function listAttemptsByRequestIds(
  requestIds: string[],
  userId?: string,
): Promise<Map<string, ErrorLogRow[]>> {
  if (requestIds.length === 0) return new Map();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const t = s.gatewayAttempts;
  const e = s.gatewayExecutions;
  const conds: SQL[] = [
    inArray(e.requestId, requestIds),
    inArray(t.status, ["failed", "interrupted", "rejected"]),
  ];
  if (userId) conds.push(eq(e.userId, userId));
  const rowsRaw = await db
    .select({
      row: t,
      execution: e,
      apiKeyName: s.apiKeys.name,
      userName: s.user.name,
      userEmail: s.user.email,
    })
    .from(t)
    .innerJoin(e, eq(t.executionId, e.id))
    .leftJoin(s.apiKeys, eq(e.apiKeyId, s.apiKeys.id))
    .leftJoin(s.user, eq(e.userId, s.user.id))
    .where(and(...conds));
  const out = new Map<string, ErrorLogRow[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const { row, execution, apiKeyName, userName, userEmail } of rowsRaw as any[]) {
    const r = toAttemptRow(row, execution, { apiKeyName, userName, userEmail });
    const list = out.get(r.requestId) ?? [];
    list.push(r);
    out.set(r.requestId, list);
  }
  // 组内按 attempt 升序。
  for (const list of out.values()) {
    list.sort((a, b) => (a.attempt ?? 0) - (b.attempt ?? 0));
  }
  return out;
}

// ===========================================================================
// typeahead 候选搜索(迭代 v2):错误表 Combobox 输入时调用,支持级联 filter。
// distinct + 大小写不敏感 LIKE + 按 userId/providerName 过滤。限 30。
// ===========================================================================

export type ErrorCandidateType = "users" | "keys" | "providers" | "models" | "upstreamKeys";

export interface ErrorCandidate {
  id: string;
  label: string;
  sub?: string;
}

export interface SearchErrorCandidatesOpts {
  type: ErrorCandidateType;
  q?: string;
  /** 级联:已选用户(panel 固定自己;admin 可跨用户)。 */
  userId?: string;
  /** 级联:已选服务商。 */
  providerName?: string;
  limit?: number;
}

/** 大小写不敏感 LIKE。 */
function iLike(col: SQL, q: string): SQL {
  return ilike(col, `%${q}%`);
}

/**
 * 错误表 typeahead 候选搜索。语义同 searchUsageCandidates,作用于失败 execution。
 * - users(admin):distinct userId JOIN user,q 匹配 name/email
 * - keys:distinct apiKeyId JOIN apiKeys,按 userId 过滤
 * - providers:distinct providerName,按 userId 过滤
 * - models:distinct model,按 userId+providerName 过滤
 * - upstreamKeys:distinct upstreamKeyMasked,按 userId+providerName 过滤
 */
export async function searchErrorCandidates(opts: SearchErrorCandidatesOpts): Promise<ErrorCandidate[]> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const t = s.gatewayExecutions;
  const limit = Math.min(opts.limit ?? 30, 50);
  const q = opts.q?.trim();
  const userCond = opts.userId ? eq(t.userId, opts.userId) : undefined;
  const providerCond = opts.providerName ? eq(t.providerName, opts.providerName) : undefined;

  if (opts.type === "users") {
    const rows = (await db
      .selectDistinct({ id: t.userId, name: s.user.name, email: s.user.email })
      .from(t)
      .leftJoin(s.user, eq(t.userId, s.user.id))
      .where(and(inArray(t.status, ["failed", "interrupted"]), isNotNull(t.userId), q ? or(iLike(s.user.name, q), iLike(s.user.email, q)) : undefined))
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
      .where(and(inArray(t.status, ["failed", "interrupted"]), isNotNull(t.apiKeyId), userCond, q ? iLike(s.apiKeys.name, q) : undefined))
      .limit(limit)) as { id: string | null; name: string | null }[];
    return rows.filter((r) => r.id).map((r) => ({ id: String(r.id), label: String(r.name ?? r.id) }));
  }
  if (opts.type === "providers") {
    const rows = (await db
      .selectDistinct({ v: t.providerName })
      .from(t)
      .where(and(inArray(t.status, ["failed", "interrupted"]), isNotNull(t.providerName), userCond, q ? iLike(t.providerName, q) : undefined))
      .orderBy(t.providerName)
      .limit(limit)) as { v: string | null }[];
    return rows.map((r) => r.v).filter(Boolean).map((v) => ({ id: v as string, label: v as string }));
  }
  if (opts.type === "models") {
    const rows = (await db
      .selectDistinct({ v: t.model })
      .from(t)
      .where(and(inArray(t.status, ["failed", "interrupted"]), isNotNull(t.model), userCond, providerCond, q ? iLike(t.model, q) : undefined))
      .orderBy(t.model)
      .limit(limit)) as { v: string | null }[];
    return rows.map((r) => r.v).filter(Boolean).map((v) => ({ id: v as string, label: v as string }));
  }
  // upstreamKeys
  const rows = (await db
    .selectDistinct({ v: t.upstreamKeyMasked })
    .from(t)
    .where(and(inArray(t.status, ["failed", "interrupted"]), isNotNull(t.upstreamKeyMasked), userCond, providerCond, q ? iLike(t.upstreamKeyMasked, q) : undefined))
    .orderBy(t.upstreamKeyMasked)
    .limit(limit)) as { v: string | null }[];
  return rows.map((r) => r.v).filter(Boolean).map((v) => ({ id: v as string, label: v as string }));
}
