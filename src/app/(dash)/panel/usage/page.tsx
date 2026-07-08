import { sql, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireSession } from "@/lib/session";
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
import { UsageDashboard } from "@/app/(dash)/admin/usage/UsageDashboard";
import { UsageTabs } from "@/app/(dash)/admin/usage/UsageTabs";
import {
  UsageLogsTable,
  type UsageLogClientRow,
} from "@/app/(dash)/admin/usage/UsageLogsTable";
import {
  ErrorLogsTable,
  type ErrorLogClientRow,
} from "@/app/(dash)/admin/usage/ErrorLogsTable";

export const dynamic = "force-dynamic";

const VALID_RANGES: TimeRange[] = ["24h", "7d", "30d"];
const PAGE_SIZE = 20;

function strParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function rangeToStart(rp: string | undefined): Date | undefined {
  if (rp === "") return undefined;
  const now = Date.now();
  if (rp === "24h") return new Date(now - 24 * 3600_000);
  if (rp === "7d") return new Date(now - 168 * 3600_000);
  if (rp === "30d") return new Date(now - 720 * 3600_000);
  return new Date(now - 168 * 3600_000);
}

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
  const rangeParam = strParam(sp.range);
  const range: TimeRange = VALID_RANGES.includes(rangeParam as TimeRange)
    ? (rangeParam as TimeRange)
    : "7d";
  const page = Math.max(1, Number(strParam(sp.page) ?? "1") || 1);

  return (
    <div className="space-y-8 max-w-5xl">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">{tn("myUsage")}</h1>

      <UsageTabs current={tab} basePath="/panel/usage" range={range} />

      {tab === "usage" ? (
        await renderPanelUsageTab({ userId: user.id, range, rangeParam, page, sp, db, s })
      ) : (
        await renderPanelErrorsTab({ userId: user.id, rangeParam, page, sp })
      )}
    </div>
  );
}

// ===========================================================================
// usage Tab:个人图表 + 用量明细(userId 隔离)
// ===========================================================================
async function renderPanelUsageTab({
  userId,
  range,
  rangeParam,
  page,
  sp,
  db,
  s,
}: {
  userId: string;
  range: TimeRange;
  rangeParam: string | undefined;
  page: number;
  sp: Record<string, string | string[] | undefined>;
  db: Awaited<ReturnType<typeof getDb>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any;
}) {
  const [series, byModel, bySource, totals] = await Promise.all([
    getTimeSeries(range, userId),
    getModelBreakdown(range, userId),
    getSourceBreakdown(range, userId),
    db
      .select({
        calls: sql<number>`count(*)`,
        promptTokens: sql<number>`coalesce(sum(${s.usageLogs.promptTokens}),0)`,
        completionTokens: sql<number>`coalesce(sum(${s.usageLogs.completionTokens}),0)`,
      })
      .from(s.usageLogs)
      .where(eq(s.usageLogs.userId, userId)),
  ]);

  const filters: UsageLogFilters = {
    model: strParam(sp.model),
    providerName: strParam(sp.provider),
    routeName: strParam(sp.route),
    source: strParam(sp.source),
    startAt: rangeToStart(rangeParam),
  };
  const { rows, total } = await listUsageLogs({ page, pageSize: PAGE_SIZE, userId, filters });

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
    // 用户自己的网关 key 名可下发;上游 key 是管理员配置,对 panel 不下发(数据层脱敏)。
    apiKeyName: r.apiKeyName,
    upstreamKeyMasked: null,
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
        basePath="/panel/usage"
        preservedParams={{ tab: "usage", range }}
      />
    </>
  );
}

// ===========================================================================
// errors Tab:错误请求(脱敏视图,variant=panel;userId 强制隔离)
// ===========================================================================
async function renderPanelErrorsTab({
  userId,
  rangeParam,
  page,
  sp,
}: {
  userId: string;
  rangeParam: string | undefined;
  page: number;
  sp: Record<string, string | string[] | undefined>;
}) {
  const showAuth = strParam(sp.showAuth) === "1";
  const phaseParam = strParam(sp.phase);
  const httpStatusStr = strParam(sp.httpStatus);
  const filters: ErrorLogFilters = {
    model: strParam(sp.model),
    errorPhase: phaseParam || undefined,
    httpStatus: httpStatusStr ? Number(httpStatusStr) || undefined : undefined,
    startAt: rangeToStart(rangeParam),
    excludeErrorPhase: !phaseParam && !showAuth ? "auth" : undefined,
  };
  const { rows, total } = await listErrorLogs({ page, pageSize: PAGE_SIZE, userId, filters });

  // 脱敏:panel 只下发白名单字段(createdAt/model/httpStatus/latencyMs/category)。
  // errorMessage / requestPath / provider* / route / upstream / errorCode / errorPhase /
  // source / tokens / TTFT 等敏感字段一律置空,绝不送达客户端(数据层脱敏,非仅 UI 隐藏)。
  // category 在服务端用完整线索派生后再丢弃原始敏感字段。
  const clientRows: ErrorLogClientRow[] = rows.map((r) => ({
    id: r.id,
    source: "",
    model: r.model,
    upstreamModel: null,
    providerName: null,
    providerRef: null,
    routeName: null,
    requestPath: null,
    httpStatus: r.httpStatus,
    errorCode: "",
    errorMessage: null,
    errorPhase: null,
    latencyMs: r.latencyMs,
    firstTokenLatencyMs: null,
    promptTokens: 0,
    completionTokens: 0,
    // panel 错误视图:key 双字段都不下发(数据层脱敏,非仅 UI 隐藏)。
    apiKeyName: null,
    upstreamKeyMasked: null,
    category: classifyError({
      errorCode: r.errorCode,
      httpStatus: r.httpStatus ?? undefined,
      errorMessage: r.errorMessage ?? undefined,
    }).category,
    createdAt: r.createdAt.toISOString(),
  }));

  const filterValues: Record<string, string> = {
    range: rangeParam ?? "7d",
    model: strParam(sp.model) ?? "",
    httpStatus: httpStatusStr ?? "",
    showAuth: showAuth ? "1" : "",
  };

  return (
    <ErrorLogsTable
      rows={clientRows}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      filterValues={filterValues}
      basePath="/panel/usage"
      preservedParams={{ tab: "errors" }}
      variant="panel"
    />
  );
}
