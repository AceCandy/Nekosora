"use client";
/**
 * 用量仪表盘 —— 含时间范围切换器 + 总量卡片 + 三张图表。
 * 范围切换通过更新 URL query 触发 server 重新渲染。
 */
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import {
  RequestsTrendChart, ModelTokensChart, ModelCallsPie, SourceBar,
} from "./UsageCharts";
import type { TimeRange } from "@/lib/usage-aggregate";
import type { TimeSeriesPoint, ModelRow, SourceRow } from "./UsageCharts";

const RANGES: { value: TimeRange; labelKey: "range24h" | "range7d" | "range30d" }[] = [
  { value: "24h", labelKey: "range24h" },
  { value: "7d", labelKey: "range7d" },
  { value: "30d", labelKey: "range30d" },
];

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-4 shadow-none">
      <div className="text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold">{label}</div>
      <div className="mt-1.5 text-xl font-bold font-mono text-neutral-900 dark:text-white">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">{hint}</div>}
    </div>
  );
}

export function UsageDashboard({
  range, totals, series, byModel, bySource,
}: {
  range: TimeRange;
  totals: { calls: number; promptTokens: number; completionTokens: number };
  series: TimeSeriesPoint[];
  byModel: ModelRow[];
  bySource: SourceRow[];
}) {
  const t = useTranslations("admin.usage");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setRange = (r: TimeRange) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", r);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      {/* 总量卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricCard label={t("metricTotalCalls")} value={totals.calls.toLocaleString()} hint={t("metricAllTime")} />
        <MetricCard label={t("metricTotalPromptTokens")} value={totals.promptTokens.toLocaleString()} hint={t("metricAllTime")} />
        <MetricCard label={t("metricTotalCompletionTokens")} value={totals.completionTokens.toLocaleString()} hint={t("metricAllTime")} />
      </div>

      {/* 范围选择器 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-400 dark:text-neutral-500 mr-1">{t("rangeSelector")}</span>
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => setRange(r.value)}
            className={clsx(
              "px-3 py-1 rounded-md text-xs font-medium transition-colors border",
              range === r.value
                ? "bg-sora-blue/8 text-sora-blue border-sora-blue/30 dark:bg-sora-blue/10"
                : "bg-white dark:bg-[#12141a] text-neutral-500 border-neutral-200 dark:border-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-300",
            )}
          >
            {t(r.labelKey)}
          </button>
        ))}
      </div>

      {/* 图表网格 */}
      <div className="space-y-4">
        <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 shadow-none">
          <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 mb-4">{t("chartTokensTrend")}</h3>
          {series.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-xs text-neutral-400">{t("chartEmptyRange")}</div>
          ) : (
            <RequestsTrendChart data={series} />
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 shadow-none">
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 mb-4">{t("chartModelTokens")}</h3>
            {byModel.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center text-xs text-neutral-400">{t("chartEmpty")}</div>
            ) : (
              <ModelTokensChart data={byModel} />
            )}
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 shadow-none">
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 mb-4">{t("chartCallsDistribution")}</h3>
            {byModel.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center text-xs text-neutral-400">{t("chartEmpty")}</div>
            ) : (
              <ModelCallsPie data={byModel} />
            )}
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 shadow-none">
          <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 mb-4">{t("chartSourceDistribution")}</h3>
          {bySource.length === 0 ? (
            <div className="h-[180px] flex items-center justify-center text-xs text-neutral-400">{t("chartEmpty")}</div>
          ) : (
            <SourceBar data={bySource} />
          )}
        </div>
      </div>
    </div>
  );
}
