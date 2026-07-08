/**
 * ErrorLogRepository —— ops_error_logs 的查询访问层。
 *
 * 双 dialect 兼容(pg / sqlite),业务层(admin / panel 前端 + server actions)统一调用。
 * 鉴权隔离:任何按 userId 过滤的查询,userId 必填且强制 where,防越权。
 *   - admin 后台:不传 userId(看全部)
 *   - panel 用户端:必传 userId(只看自己的)
 */
import { eq, and, gte, lte, desc, sql, type SQL } from "drizzle-orm";
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
  const t = s.opsErrorLogs;
  const conds: SQL[] = [];
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
    if (f.startAt) conds.push(gte(t.createdAt, f.startAt));
    if (f.endAt) conds.push(lte(t.createdAt, f.endAt));
  }
  return conds.length > 0 ? and(...conds) : undefined;
}

/** 把 drizzle 原始行收敛为 ErrorLogRow DTO。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(r: any): ErrorLogRow {
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
  const t = s.opsErrorLogs;
  const where = buildWhere(opts);
  const page = Math.max(1, opts.page);
  const pageSize = Math.max(1, opts.pageSize);
  const offset = (page - 1) * pageSize;

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(t)
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
  return { rows: (rows as any[]).map(toRow), total: Number(countRows[0]?.count ?? 0) };
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
  const t = s.opsErrorLogs;
  const conds: SQL[] = [eq(t.id, id)];
  if (userId) conds.push(eq(t.userId, userId));
  const [row] = await db.select().from(t).where(and(...conds)).limit(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return row ? toRow(row as any) : null;
}
