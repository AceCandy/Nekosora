"use client";
/**
 * 用量仪表盘 —— 总量卡片 + 三张图表。
 * 范围由筛选栏驱动(筛选栏 range query → server 重查 series/byModel/bySource 后注入);
 * 本组件不再持有 range 选择器(已上移到筛选栏,避免双 range 源)。
 */
import { useTranslations } from "next-intl";
import {
  RequestsTrendChart, ModelTokensChart, ModelCallsPie, SourceBar,
} from "./UsageCharts";
import type { TimeSeriesPoint, ModelRow, SourceRow } from "./UsageCharts";

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-4 shadow-none">
      <div className="text-ui-caption uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold">{label}</div>
      <div className="mt-1.5 text-ui-subheading font-bold font-mono text-neutral-900 dark:text-white">{value}</div>
      {hint && <div className="mt-0.5 text-ui-caption text-neutral-400 dark:text-neutral-500">{hint}</div>}
    </div>
  );
}

export function UsageDashboard({
  totals, series, byModel, bySource,
}: {
  totals: { calls: number; promptTokens: number; completionTokens: number };
  series: TimeSeriesPoint[];
  byModel: ModelRow[];
  bySource: SourceRow[];
}) {
  const t = useTranslations("admin.usage");

  return (
    <div className="space-y-6">
      {/* 总量卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricCard label={t("metricTotalCalls")} value={totals.calls.toLocaleString()} hint={t("metricAllTime")} />
        <MetricCard label={t("metricTotalPromptTokens")} value={totals.promptTokens.toLocaleString()} hint={t("metricAllTime")} />
        <MetricCard label={t("metricTotalCompletionTokens")} value={totals.completionTokens.toLocaleString()} hint={t("metricAllTime")} />
      </div>

      {/* 图表网格 */}
      <div className="space-y-4">
        <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 shadow-none">
          <h3 className="text-ui-body font-semibold text-neutral-700 dark:text-neutral-200 mb-4">{t("chartTokensTrend")}</h3>
          {series.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-ui-caption text-neutral-400">{t("chartEmptyRange")}</div>
          ) : (
            <RequestsTrendChart data={series} />
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 shadow-none">
            <h3 className="text-ui-body font-semibold text-neutral-700 dark:text-neutral-200 mb-4">{t("chartModelTokens")}</h3>
            {byModel.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center text-ui-caption text-neutral-400">{t("chartEmpty")}</div>
            ) : (
              <ModelTokensChart data={byModel} />
            )}
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 shadow-none">
            <h3 className="text-ui-body font-semibold text-neutral-700 dark:text-neutral-200 mb-4">{t("chartCallsDistribution")}</h3>
            {byModel.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center text-ui-caption text-neutral-400">{t("chartEmpty")}</div>
            ) : (
              <ModelCallsPie data={byModel} />
            )}
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 shadow-none">
          <h3 className="text-ui-body font-semibold text-neutral-700 dark:text-neutral-200 mb-4">{t("chartSourceDistribution")}</h3>
          {bySource.length === 0 ? (
            <div className="h-[180px] flex items-center justify-center text-ui-caption text-neutral-400">{t("chartEmpty")}</div>
          ) : (
            <SourceBar data={bySource} />
          )}
        </div>
      </div>
    </div>
  );
}
