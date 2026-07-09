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
import { strParam, parseTimeRange } from "@/app/(dash)/admin/usage/time-range";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function PanelUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession();
  const tn = await getTranslations("nav");
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const sp = await searchParams;
  const tabParam = strParam(sp.tab);
  const tab: "usage" | "errors" = tabParam === "errors" ? "errors" : "usage";
  const page = Math.max(1, Number(strParam(sp.page) ?? "1") || 1);
  const timeRange = parseTimeRange(sp);

  // 统计区(跨 tab 共享;按 userId 隔离)。
  const [series, byModel, bySource, totals] = await Promise.all([
    getTimeSeries(timeRange.chartRange, user.id),
    getModelBreakdown(timeRange.chartRange, user.id),
    getSourceBreakdown(timeRange.chartRange, user.id),
    db
      .select({
        calls: sql<number>`count(*)`,
        promptTokens: sql<number>`coalesce(sum(${s.usageLogs.promptTokens}),0)`,
        completionTokens: sql<number>`coalesce(sum(${s.usageLogs.completionTokens}),0)`,
      })
      .from(s.usageLogs)
      .where(eq(s.usageLogs.userId, user.id)),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">{tn("myUsage")}</h1>

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

      {tab === "usage" ? (
        await renderPanelUsageTab({ userId: user.id, sp, page, timeRange, db, s })
      ) : (
        await renderPanelErrorsTab({ userId: user.id, sp, page, timeRange, db, s })
      )}
    </div>
  );
}

// ===========================================================================
// usage Tab:用量明细(userId 隔离 + UsageFilterBar typeahead + 执行链路列)
// ===========================================================================
async function renderPanelUsageTab({
  userId,
  sp,
  page,
  timeRange,
  db,
  s,
}: {
  userId: string;
  sp: Record<string, string | string[] | undefined>;
  page: number;
  timeRange: ReturnType<typeof parseTimeRange>;
  db: Awaited<ReturnType<typeof getDb>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any;
}) {
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
  const [{ rows, total }, keyLabelRow] = await Promise.all([
    listUsageLogs({ page, pageSize: PAGE_SIZE, userId, filters }),
    keyParam
      ? db
          .select({ name: s.apiKeys.name })
          .from(s.apiKeys)
          .where(and(eq(s.apiKeys.id, keyParam), eq(s.apiKeys.userId, userId)))
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
    // panel:上游 key 是管理员配置,不下发(数据层脱敏);执行链路列不显示上游key。
    upstreamKeyMasked: null,
    userName: null,
    userEmail: null,
    taskKind: r.taskKind,
    createdAt: r.createdAt.toISOString(),
  }));

  const filterValues: UsageFilterValues = {
    range: timeRange.range,
    start: timeRange.start,
    end: timeRange.end,
    user: "",
    source: strParam(sp.source) ?? "",
    key: keyParam ?? "",
    provider: strParam(sp.provider) ?? "",
    model: strParam(sp.model) ?? "",
    upstreamKey: strParam(sp.upstreamKey) ?? "",
  };

  const labels = { key: (keyLabelRow[0] as { name?: string } | undefined)?.name };

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
      variant="panel"
    />
  );
}

// ===========================================================================
// errors Tab:错误请求(放宽脱敏:自己调用全字段可见;userId 强制隔离;ErrorFilterBar 两排筛选)
// ===========================================================================
async function renderPanelErrorsTab({
  userId,
  sp,
  page,
  timeRange,
  db,
  s,
}: {
  userId: string;
  sp: Record<string, string | string[] | undefined>;
  page: number;
  timeRange: ReturnType<typeof parseTimeRange>;
  db: Awaited<ReturnType<typeof getDb>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any;
}) {
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
  const [{ rows, total }, keyLabelRow] = await Promise.all([
    listErrorLogs({ page, pageSize: PAGE_SIZE, userId, filters }),
    keyParam
      ? db
          .select({ name: s.apiKeys.name })
          .from(s.apiKeys)
          .where(and(eq(s.apiKeys.id, keyParam), eq(s.apiKeys.userId, userId)))
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
    userName: null,
    userEmail: null,
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
    user: "",
    source: strParam(sp.source) ?? "",
    key: keyParam ?? "",
    phase: phaseParam ?? "",
    provider: strParam(sp.provider) ?? "",
    model: strParam(sp.model) ?? "",
    upstreamKey: strParam(sp.upstreamKey) ?? "",
    httpStatus: httpStatusStr ?? "",
    showAuth: showAuth ? "1" : "",
  };

  const labels = { key: (keyLabelRow[0] as { name?: string } | undefined)?.name };

  return (
    <ErrorLogsTable
      rows={clientRows}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      filterValues={filterValues}
      labels={labels}
      basePath="/panel/usage"
      variant="panel"
    />
  );
}
