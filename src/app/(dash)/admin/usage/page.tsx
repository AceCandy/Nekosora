import { sql, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireAdmin } from "@/lib/session";
import {
  getTimeSeries,
  getModelBreakdown,
  getSourceBreakdown,
  listUsageLogs,
  type UsageLogFilters,
} from "@/lib/usage-aggregate";
import { listErrorLogs, type ErrorLogFilters } from "@/lib/repositories/error-log-repository";
import { classifyError } from "@/lib/error-classify";
import { UsageDashboard } from "./UsageDashboard";
import { CollapsibleStats } from "./CollapsibleStats";
import { UsageTabs } from "./UsageTabs";
import { UsageLogsTable, type UsageLogClientRow } from "./UsageLogsTable";
import { type UsageFilterValues } from "./UsageFilterBar";
import { ErrorLogsTable, type ErrorLogClientRow } from "./ErrorLogsTable";
import { type ErrorFilterValues } from "./ErrorFilterBar";
import { strParam, parseTimeRange } from "./time-range";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const tn = await getTranslations("nav");
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const sp = await searchParams;
  const tabParam = strParam(sp.tab);
  const tab: "usage" | "errors" = tabParam === "errors" ? "errors" : "usage";
  const page = Math.max(1, Number(strParam(sp.page) ?? "1") || 1);
  const timeRange = parseTimeRange(sp);

  // 统计区(跨 tab 共享)用 chartRange。
  const [series, byModel, bySource, totals] = await Promise.all([
    getTimeSeries(timeRange.chartRange),
    getModelBreakdown(timeRange.chartRange),
    getSourceBreakdown(timeRange.chartRange),
    db.select({
      calls: sql<number>`count(*)`,
      promptTokens: sql<number>`coalesce(sum(${s.usageLogs.promptTokens}),0)`,
      completionTokens: sql<number>`coalesce(sum(${s.usageLogs.completionTokens}),0)`,
    }).from(s.usageLogs),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">{tn("usage")}</h1>

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

      <UsageTabs current={tab} basePath="/admin/usage" range={timeRange.range} />

      {tab === "usage" ? (
        await renderUsageTab({ sp, page, timeRange, db, s })
      ) : (
        await renderErrorsTab({ sp, page, timeRange, db, s })
      )}
    </div>
  );
}

// ===========================================================================
// usage Tab:用量明细(UsageFilterBar typeahead + 执行链路列)
// ===========================================================================
async function renderUsageTab({
  sp,
  page,
  timeRange,
  db,
  s,
}: {
  sp: Record<string, string | string[] | undefined>;
  page: number;
  timeRange: ReturnType<typeof parseTimeRange>;
  db: Awaited<ReturnType<typeof getDb>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any;
}) {
  const userParam = strParam(sp.user);
  const keyParam = strParam(sp.key);
  const filters: UsageLogFilters = {
    model: strParam(sp.model),
    providerName: strParam(sp.provider),
    source: strParam(sp.source),
    userId: userParam,
    apiKeyId: keyParam,
    upstreamKeyMasked: strParam(sp.upstreamKey),
    startAt: timeRange.startAt,
    endAt: timeRange.endAt,
  };

  const [{ rows, total }, userLabelRow, keyLabelRow] = await Promise.all([
    listUsageLogs({ page, pageSize: PAGE_SIZE, filters }),
    userParam
      ? db.select({ name: s.user.name }).from(s.user).where(eq(s.user.id, userParam)).limit(1)
      : Promise.resolve([]),
    keyParam
      ? db.select({ name: s.apiKeys.name }).from(s.apiKeys).where(eq(s.apiKeys.id, keyParam)).limit(1)
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
    upstreamKeyMasked: r.upstreamKeyMasked,
    userName: r.userName,
    userEmail: r.userEmail,
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
    user: (userLabelRow[0] as { name?: string } | undefined)?.name,
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
      basePath="/admin/usage"
      tab="usage"
    />
  );
}

// ===========================================================================
// errors Tab:错误请求(ErrorFilterBar 两排 typeahead + 执行链路列;时间与 usage 共享 parseTimeRange)
// ===========================================================================
async function renderErrorsTab({
  sp,
  page,
  timeRange,
  db,
  s,
}: {
  sp: Record<string, string | string[] | undefined>;
  page: number;
  timeRange: ReturnType<typeof parseTimeRange>;
  db: Awaited<ReturnType<typeof getDb>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any;
}) {
  const userParam = strParam(sp.user);
  const keyParam = strParam(sp.key);
  const showAuth = strParam(sp.showAuth) === "1";
  const phaseParam = strParam(sp.phase);
  const httpStatusStr = strParam(sp.httpStatus);
  const filters: ErrorLogFilters = {
    model: strParam(sp.model),
    providerName: strParam(sp.provider),
    source: strParam(sp.source),
    userId: userParam,
    apiKeyId: keyParam,
    upstreamKeyMasked: strParam(sp.upstreamKey),
    errorPhase: phaseParam || undefined,
    httpStatus: httpStatusStr ? Number(httpStatusStr) || undefined : undefined,
    startAt: timeRange.startAt,
    endAt: timeRange.endAt,
    excludeErrorPhase: !phaseParam && !showAuth ? "auth" : undefined,
  };

  const [{ rows, total }, userLabelRow, keyLabelRow] = await Promise.all([
    listErrorLogs({ page, pageSize: PAGE_SIZE, filters }),
    userParam
      ? db.select({ name: s.user.name }).from(s.user).where(eq(s.user.id, userParam)).limit(1)
      : Promise.resolve([]),
    keyParam
      ? db.select({ name: s.apiKeys.name }).from(s.apiKeys).where(eq(s.apiKeys.id, keyParam)).limit(1)
      : Promise.resolve([]),
  ]);

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
    userName: r.userName,
    userEmail: r.userEmail,
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
    user: (userLabelRow[0] as { name?: string } | undefined)?.name,
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
      basePath="/admin/usage"
      variant="admin"
    />
  );
}
