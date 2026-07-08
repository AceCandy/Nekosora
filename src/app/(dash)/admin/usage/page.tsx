import { sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireAdmin } from "@/lib/session";
import {
  getTimeSeries,
  getModelBreakdown,
  getSourceBreakdown,
  listUsageLogs,
  type TimeRange,
  type UsageLogFilters,
} from "@/lib/usage-aggregate";
import { listErrorLogs, type ErrorLogFilters } from "@/lib/repositories/error-log-repository";
import { classifyError } from "@/lib/error-classify";
import { UsageDashboard } from "./UsageDashboard";
import { UsageTabs } from "./UsageTabs";
import { UsageLogsTable, type UsageLogClientRow } from "./UsageLogsTable";
import { ErrorLogsTable, type ErrorLogClientRow } from "./ErrorLogsTable";

export const dynamic = "force-dynamic";

const VALID_RANGES: TimeRange[] = ["24h", "7d", "30d"];
const PAGE_SIZE = 20;

/** searchParams 值归一化为 string | undefined。 */
function strParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** range → startAt;空串表示显式「全部」(不限时间)。 */
function rangeToStart(rp: string | undefined): Date | undefined {
  if (rp === "") return undefined;
  const now = Date.now();
  if (rp === "24h") return new Date(now - 24 * 3600_000);
  if (rp === "7d") return new Date(now - 168 * 3600_000);
  if (rp === "30d") return new Date(now - 720 * 3600_000);
  return new Date(now - 168 * 3600_000); // 缺省/非法 → 7d
}

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
  const rangeParam = strParam(sp.range);
  const range: TimeRange = VALID_RANGES.includes(rangeParam as TimeRange)
    ? (rangeParam as TimeRange)
    : "7d";
  const page = Math.max(1, Number(strParam(sp.page) ?? "1") || 1);

  return (
    <div className="space-y-8 max-w-5xl">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">{tn("usage")}</h1>

      <UsageTabs current={tab} basePath="/admin/usage" range={range} />

      {tab === "usage" ? (
        await renderUsageTab({ range, rangeParam, page, sp, db, s })
      ) : (
        await renderErrorsTab({ rangeParam, page, sp })
      )}
    </div>
  );
}

// ===========================================================================
// usage Tab:总量卡片 + 图表 + 用量明细分页表(成功计费)
// ===========================================================================
async function renderUsageTab({
  range,
  rangeParam,
  page,
  sp,
  db,
  s,
}: {
  range: TimeRange;
  rangeParam: string | undefined;
  page: number;
  sp: Record<string, string | string[] | undefined>;
  db: Awaited<ReturnType<typeof getDb>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any;
}) {
  const [series, byModel, bySource, totals] = await Promise.all([
    getTimeSeries(range),
    getModelBreakdown(range),
    getSourceBreakdown(range),
    db.select({
      calls: sql<number>`count(*)`,
      promptTokens: sql<number>`coalesce(sum(${s.usageLogs.promptTokens}),0)`,
      completionTokens: sql<number>`coalesce(sum(${s.usageLogs.completionTokens}),0)`,
    }).from(s.usageLogs),
  ]);

  const filters: UsageLogFilters = {
    model: strParam(sp.model),
    providerName: strParam(sp.provider),
    routeName: strParam(sp.route),
    source: strParam(sp.source),
    startAt: rangeToStart(rangeParam),
  };
  const { rows, total } = await listUsageLogs({ page, pageSize: PAGE_SIZE, filters });

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
    latencyMs: r.latencyMs,
    firstTokenLatencyMs: r.firstTokenLatencyMs,
    createdAt: r.createdAt.toISOString(),
  }));

  const filterValues: Record<string, string> = {
    model: strParam(sp.model) ?? "",
    provider: strParam(sp.provider) ?? "",
    route: strParam(sp.route) ?? "",
    source: strParam(sp.source) ?? "",
  };

  return (
    <>
      <UsageDashboard
        range={range}
        totals={{
          calls: Number(totals[0]?.calls ?? 0),
          promptTokens: Number(totals[0]?.promptTokens ?? 0),
          completionTokens: Number(totals[0]?.completionTokens ?? 0),
        }}
        series={series}
        byModel={byModel}
        bySource={bySource}
      />
      <UsageLogsTable
        rows={clientRows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        filterValues={filterValues}
        basePath="/admin/usage"
        preservedParams={{ tab: "usage", range }}
      />
    </>
  );
}

// ===========================================================================
// errors Tab:错误请求分页表(ops_error_logs)
// ===========================================================================
async function renderErrorsTab({
  rangeParam,
  page,
  sp,
}: {
  rangeParam: string | undefined;
  page: number;
  sp: Record<string, string | string[] | undefined>;
}) {
  const showAuth = strParam(sp.showAuth) === "1";
  const phaseParam = strParam(sp.phase);
  const httpStatusStr = strParam(sp.httpStatus);
  const filters: ErrorLogFilters = {
    model: strParam(sp.model),
    providerName: strParam(sp.provider),
    errorPhase: phaseParam || undefined,
    httpStatus: httpStatusStr ? Number(httpStatusStr) || undefined : undefined,
    source: strParam(sp.source),
    startAt: rangeToStart(rangeParam),
    // 默认隐藏 auth 噪声(扫描流量放大),除非用户显式选了 phase=auth 或勾选「包含鉴权错误」
    excludeErrorPhase: !phaseParam && !showAuth ? "auth" : undefined,
  };
  const { rows, total } = await listErrorLogs({ page, pageSize: PAGE_SIZE, filters });

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
    category: classifyError({
      errorCode: r.errorCode,
      httpStatus: r.httpStatus ?? undefined,
      errorMessage: r.errorMessage ?? undefined,
    }).category,
    createdAt: r.createdAt.toISOString(),
  }));

  const filterValues: Record<string, string> = {
    range: rangeParam ?? "7d",
    phase: phaseParam ?? "",
    model: strParam(sp.model) ?? "",
    provider: strParam(sp.provider) ?? "",
    httpStatus: httpStatusStr ?? "",
    source: strParam(sp.source) ?? "",
    showAuth: showAuth ? "1" : "",
  };

  return (
    <ErrorLogsTable
      rows={clientRows}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      filterValues={filterValues}
      basePath="/admin/usage"
      preservedParams={{ tab: "errors" }}
      variant="admin"
    />
  );
}
