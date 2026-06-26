import { desc, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireAdmin } from "@/lib/session";
import { getTimeSeries, getModelBreakdown, getSourceBreakdown, type TimeRange } from "@/lib/usage-aggregate";
import { UsageDashboard } from "./UsageDashboard";

// 支持的时间范围(query 参数)。默认 7d。
const VALID_RANGES = new Set<TimeRange>(["24h", "7d", "30d"]);

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requireAdmin();
  const t = await getTranslations("admin.usage");
  const tn = await getTranslations("nav");
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const { range: rangeParam } = await searchParams;
  const range: TimeRange = VALID_RANGES.has(rangeParam as TimeRange)
    ? (rangeParam as TimeRange)
    : "7d";

  // 图表数据(按选定时间范围)
  const [series, byModel, bySource] = await Promise.all([
    getTimeSeries(range),
    getModelBreakdown(range),
    getSourceBreakdown(range),
  ]);

  // 总量统计(全表,不受时间范围影响)
  const totals = await db
    .select({
      calls: sql<number>`count(*)`,
      promptTokens: sql<number>`coalesce(sum(${s.usageLogs.promptTokens}),0)`,
      completionTokens: sql<number>`coalesce(sum(${s.usageLogs.completionTokens}),0)`,
    })
    .from(s.usageLogs);

  const recent = await db
    .select()
    .from(s.usageLogs)
    .orderBy(desc(s.usageLogs.createdAt))
    .limit(20);

  return (
    <div className="space-y-10 max-w-5xl">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">{tn("usage")}</h1>

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

      <div className="space-y-4">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">{t("recentLogs")}</h2>
        <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] overflow-hidden shadow-none transition-all duration-200">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-neutral-50/70 border-b border-neutral-200 text-neutral-500 dark:bg-neutral-900/50 dark:border-neutral-800 dark:text-neutral-400 uppercase tracking-wider font-semibold">
                  <th className="text-left px-4 py-3 font-semibold">{t("thSource")}</th>
                  <th className="text-left px-4 py-3 font-semibold">{t("thModel")}</th>
                  <th className="text-left px-4 py-3 font-semibold">{t("thUpstream")}</th>
                  <th className="text-right px-4 py-3 font-semibold">{t("thTotalTokens")}</th>
                  <th className="text-right px-4 py-3 font-semibold">{t("thLatency")}</th>
                  <th className="text-right px-4 py-3 font-semibold">{t("thStatus")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {recent.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-neutral-400 dark:text-neutral-500">
                      {t("emptyLogs")}
                    </td>
                  </tr>
                )}
                {recent.map((r: Record<string, unknown>) => {
                  const isSuccess = String(r.status).startsWith("2") || r.status === "success" || r.status === "active";
                  return (
                    <tr
                      key={r.id as string}
                      className="hover:bg-neutral-50/30 dark:hover:bg-neutral-900/10 transition-colors duration-150"
                    >
                      <td className="px-4 py-3 font-medium text-neutral-700 dark:text-neutral-300 max-w-[120px] truncate font-mono">
                        {r.source as string}
                      </td>
                      <td className="px-4 py-3 font-mono text-neutral-900 dark:text-white">
                        {r.model as string}
                      </td>
                      <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                        {(r.providerRef as string) ?? "-"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-neutral-800 dark:text-neutral-200">
                        {(Number(r.promptTokens) + Number(r.completionTokens)).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-neutral-500 dark:text-neutral-400">
                        {r.latencyMs != null ? `${r.latencyMs}ms` : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isSuccess ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400 border border-green-500/10">
                            <span className="w-1 h-1 rounded-full bg-green-500"></span>
                            {String(r.status)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400 border border-red-500/10">
                            <span className="w-1 h-1 rounded-full bg-red-500"></span>
                            {String(r.status)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
