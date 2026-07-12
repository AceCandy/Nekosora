import { sql, eq, and } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireSession } from "@/lib/session";
import {
  getTimeSeries,
  getModelBreakdown,
  getSourceBreakdown,
  listUsageLogs,
  type UsageLogFilters,
} from "@/lib/usage-aggregate";
import { listErrorLogs, type ErrorLogFilters } from "@/lib/repositories/error-log-repository";
import { classifyError } from "@/lib/error-classify";
import { UsageDashboard } from "@/app/(dash)/admin/usage/UsageDashboard";
import { CollapsibleStats } from "@/app/(dash)/admin/usage/CollapsibleStats";
import { UsageTabs } from "@/app/(dash)/admin/usage/UsageTabs";
import { UsageLogsTable, type UsageLogClientRow } from "@/app/(dash)/admin/usage/UsageLogsTable";
import { type UsageFilterValues } from "@/app/(dash)/admin/usage/UsageFilterBar";
import { ErrorLogsTable, type ErrorLogClientRow } from "@/app/(dash)/admin/usage/ErrorLogsTable";
import { type ErrorFilterValues } from "@/app/(dash)/admin/usage/ErrorFilterBar";
import {
  strParam,
  parseTimeRange,
  resolveEffectiveUserId,
  ALL_USERS,
} from "@/app/(dash)/admin/usage/time-range";
import { PageHeader } from "@/shared/components/PageHeader";
import { BarChart3 } from "lucide-react";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

/**
 * 用量查询合一入口(/panel/usage):一套页面按权限做数据隔离。
 * - admin:默认查自己,用户筛选可切「全部用户」或指定用户;用户列/上游 key 全字段可见。
 * - 普通用户:强制查自己(忽略 URL user 参数,防越权);隐藏用户筛选,上游 key 在用量明细脱敏。
 */
export default async function PanelUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession();
  const isAdmin = user.role === "admin";
  const t = await getTranslations("admin.usage");
  const tn = await getTranslations("nav");
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const sp = await searchParams;
  const tabParam = strParam(sp.tab);
  const tab: "usage" | "errors" = tabParam === "errors" ? "errors" : "usage";
  const page = Math.max(1, Number(strParam(sp.page) ?? "1") || 1);
  const timeRange = parseTimeRange(sp);

  // 数据隔离收敛点(服务端强制):admin 默认自己 / 指定 / 全部;普通用户强制自己。
  const userParam = strParam(sp.user);
  const queryAllUsers = isAdmin && userParam === ALL_USERS;
  const effectiveUserId = resolveEffectiveUserId({ isAdmin, userParam, selfId: user.id });

  // 统计区(跨 tab 共享,按 effectiveUserId 范围)。
  const [series, byModel, bySource, totals] = await Promise.all([
    getTimeSeries(timeRange.chartRange, effectiveUserId),
    getModelBreakdown(timeRange.chartRange, effectiveUserId),
    getSourceBreakdown(timeRange.chartRange, effectiveUserId),
    db
      .select({
        calls: sql<number>`count(*)`,
        promptTokens: sql<number>`coalesce(sum(${s.usageLogs.promptTokens}),0)`,
        completionTokens: sql<number>`coalesce(sum(${s.usageLogs.completionTokens}),0)`,
      })
      .from(s.usageLogs)
      .where(effectiveUserId ? eq(s.usageLogs.userId, effectiveUserId) : undefined),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader icon={BarChart3} title={tn("myUsage")} desc={t("desc")} />

      <CollapsibleStats>
        <UsageDashboard
          totals={{
            calls: Number(totals[0]?.calls ?? 0),
            promptTokens: Number(totals[0]?.promptTokens ?? 0),
            completionTokens: Number(totals[0]?.completionTokens ?? 0),
          }}
          series={series}
          byModel={byModel}
          bySource={bySource}
        />
      </CollapsibleStats>

      <UsageTabs current={tab} basePath="/panel/usage" range={timeRange.range} />

      {tab === "usage"
        ? await renderUsageTab({ isAdmin, effectiveUserId, selfId: user.id, sp, page, timeRange, db, s, t })
        : await renderErrorsTab({ isAdmin, effectiveUserId, selfId: user.id, sp, page, timeRange, db, s, t })}
    </div>
  );
}

// ===========================================================================
// usage Tab:用量明细(admin 全字段;panel 脱敏用户列 + 上游 key)。userId 由 effectiveUserId 统一隔离。
// ===========================================================================
async function renderUsageTab({
  isAdmin,
  effectiveUserId,
  selfId,
  sp,
  page,
  timeRange,
  db,
  s,
  t,
}: {
  isAdmin: boolean;
  effectiveUserId: string | undefined;
  selfId: string;
  sp: Record<string, string | string[] | undefined>;
  page: number;
  timeRange: ReturnType<typeof parseTimeRange>;
  db: Awaited<ReturnType<typeof getDb>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const userParam = strParam(sp.user);
  const queryAllUsers = isAdmin && userParam === ALL_USERS;
  const keyParam = strParam(sp.key);
  const filters: UsageLogFilters = {
    model: strParam(sp.model),
    providerName: strParam(sp.provider),
    source: strParam(sp.source),
    apiKeyId: keyParam,
    upstreamKeyMasked: strParam(sp.upstreamKey),
    startAt: timeRange.startAt,
    endAt: timeRange.endAt,
  };

  const [{ rows, total }, userLabelRow, keyLabelRow] = await Promise.all([
    listUsageLogs({ page, pageSize: PAGE_SIZE, userId: effectiveUserId, filters }),
    isAdmin && userParam && !queryAllUsers
      ? db.select({ name: s.user.name }).from(s.user).where(eq(s.user.id, userParam)).limit(1)
      : Promise.resolve([]),
    keyParam
      ? db
          .select({ name: s.apiKeys.name })
          .from(s.apiKeys)
          .where(
            isAdmin
              ? eq(s.apiKeys.id, keyParam)
              : and(eq(s.apiKeys.id, keyParam), eq(s.apiKeys.userId, selfId)),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);

  const clientRows: UsageLogClientRow[] = rows.map((r) => ({
    id: r.id,
    source: r.source,
    model: r.model,
    providerRef: r.providerRef,
    providerName: r.providerName,
    routeName: r.routeName,
    upstreamModel: r.upstreamModel,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    cacheReadTokens: r.cacheReadTokens,
    latencyMs: r.latencyMs,
    firstTokenLatencyMs: r.firstTokenLatencyMs,
    apiKeyName: r.apiKeyName,
    // panel 数据层脱敏:用量明细不下发上游 key;admin 视角全字段可见。
    upstreamKeyMasked: isAdmin ? r.upstreamKeyMasked : null,
    userName: isAdmin ? r.userName : null,
    userEmail: isAdmin ? r.userEmail : null,
    taskKind: r.taskKind,
    createdAt: r.createdAt.toISOString(),
  }));

  const filterValues: UsageFilterValues = {
    range: timeRange.range,
    start: timeRange.start,
    end: timeRange.end,
    user: userParam ?? "",
    source: strParam(sp.source) ?? "",
    key: keyParam ?? "",
    provider: strParam(sp.provider) ?? "",
    model: strParam(sp.model) ?? "",
    upstreamKey: strParam(sp.upstreamKey) ?? "",
  };

  const labels = {
    user: queryAllUsers ? t("allUsers") : (userLabelRow[0] as { name?: string } | undefined)?.name,
    key: (keyLabelRow[0] as { name?: string } | undefined)?.name,
  };

  return (
    <UsageLogsTable
      rows={clientRows}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      filterValues={filterValues}
      labels={labels}
      basePath="/panel/usage"
      tab="usage"
      variant={isAdmin ? "admin" : "panel"}
    />
  );
}

// ===========================================================================
// errors Tab:错误请求(admin 全字段;panel 全字段可见但无用户列,因均为自己调用)。
// userId 由 effectiveUserId 统一隔离。
// ===========================================================================
async function renderErrorsTab({
  isAdmin,
  effectiveUserId,
  selfId,
  sp,
  page,
  timeRange,
  db,
  s,
  t,
}: {
  isAdmin: boolean;
  effectiveUserId: string | undefined;
  selfId: string;
  sp: Record<string, string | string[] | undefined>;
  page: number;
  timeRange: ReturnType<typeof parseTimeRange>;
  db: Awaited<ReturnType<typeof getDb>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const userParam = strParam(sp.user);
  const queryAllUsers = isAdmin && userParam === ALL_USERS;
  const keyParam = strParam(sp.key);
  const showAuth = strParam(sp.showAuth) === "1";
  const phaseParam = strParam(sp.phase);
  const httpStatusStr = strParam(sp.httpStatus);
  const filters: ErrorLogFilters = {
    model: strParam(sp.model),
    providerName: strParam(sp.provider),
    source: strParam(sp.source),
    apiKeyId: keyParam,
    upstreamKeyMasked: strParam(sp.upstreamKey),
    errorPhase: phaseParam || undefined,
    httpStatus: httpStatusStr ? Number(httpStatusStr) || undefined : undefined,
    startAt: timeRange.startAt,
    endAt: timeRange.endAt,
    excludeErrorPhase: !phaseParam && !showAuth ? "auth" : undefined,
  };

  const [{ rows, total }, userLabelRow, keyLabelRow] = await Promise.all([
    listErrorLogs({ page, pageSize: PAGE_SIZE, userId: effectiveUserId, filters }),
    isAdmin && userParam && !queryAllUsers
      ? db.select({ name: s.user.name }).from(s.user).where(eq(s.user.id, userParam)).limit(1)
      : Promise.resolve([]),
    keyParam
      ? db
          .select({ name: s.apiKeys.name })
          .from(s.apiKeys)
          .where(
            isAdmin
              ? eq(s.apiKeys.id, keyParam)
              : and(eq(s.apiKeys.id, keyParam), eq(s.apiKeys.userId, selfId)),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);

  // panel 放宽:错误日志均为用户自己调用产生,全字段可见(与 admin 同款);仅无用户列。
  const clientRows: ErrorLogClientRow[] = rows.map((r) => ({
    id: r.id,
    source: r.source,
    model: r.model,
    upstreamModel: r.upstreamModel,
    providerName: r.providerName,
    providerRef: r.providerRef,
    routeName: r.routeName,
    requestPath: r.requestPath,
    httpStatus: r.httpStatus,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    errorPhase: r.errorPhase,
    latencyMs: r.latencyMs,
    firstTokenLatencyMs: r.firstTokenLatencyMs,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    apiKeyName: r.apiKeyName,
    upstreamKeyMasked: r.upstreamKeyMasked,
    userName: isAdmin ? r.userName : null,
    userEmail: isAdmin ? r.userEmail : null,
    taskKind: r.taskKind,
    category: classifyError({
      errorCode: r.errorCode,
      httpStatus: r.httpStatus ?? undefined,
      errorMessage: r.errorMessage ?? undefined,
    }).category,
    createdAt: r.createdAt.toISOString(),
  }));

  const filterValues: ErrorFilterValues = {
    range: timeRange.range,
    start: timeRange.start,
    end: timeRange.end,
    user: userParam ?? "",
    source: strParam(sp.source) ?? "",
    key: keyParam ?? "",
    phase: phaseParam ?? "",
    provider: strParam(sp.provider) ?? "",
    model: strParam(sp.model) ?? "",
    upstreamKey: strParam(sp.upstreamKey) ?? "",
    httpStatus: httpStatusStr ?? "",
    showAuth: showAuth ? "1" : "",
  };

  const labels = {
    user: queryAllUsers ? t("allUsers") : (userLabelRow[0] as { name?: string } | undefined)?.name,
    key: (keyLabelRow[0] as { name?: string } | undefined)?.name,
  };

  return (
    <ErrorLogsTable
      rows={clientRows}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      filterValues={filterValues}
      labels={labels}
      basePath="/panel/usage"
      variant={isAdmin ? "admin" : "panel"}
    />
  );
}
