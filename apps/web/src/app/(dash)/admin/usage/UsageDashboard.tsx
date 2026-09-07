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

export function UsageSummary({ totals }: {
  totals: { calls: number; promptTokens: number; completionTokens: number };
}) {
  const t = useTranslations("admin.usage");
  return (
    <section aria-label={t("summaryLabel")} className="border-y border-morning-mist py-3">
      <p className="mb-2 text-ui-caption text-neutral-600">{t("statsScope")}</p>
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        {[
          [t("metricTotalCalls"), totals.calls],
          [t("metricTotalPromptTokens"), totals.promptTokens],
          [t("metricTotalCompletionTokens"), totals.completionTokens],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-ui-caption text-neutral-600">{label}</dt>
            <dd className="mt-1 font-mono text-ui-body font-semibold tabular-nums text-space-ink">{value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function UsageDashboard({
  series, byModel, bySource,
}: {
  series: TimeSeriesPoint[];
  byModel: ModelRow[];
  bySource: SourceRow[];
}) {
  const t = useTranslations("admin.usage");

  return (
    <div className="space-y-6">
      <p className="text-ui-caption text-neutral-600">{t("statsScope")}</p>
      {series.length === 0 && byModel.length === 0 && bySource.length === 0 ? (
        <p className="py-8 text-center text-ui-body text-neutral-600">{t("chartEmptyRange")}</p>
      ) : (
      <div className="space-y-4">
        <div className="rounded-lg border border-neutral-200 bg-white   p-5 shadow-none">
          <h3 className="text-ui-body font-semibold text-neutral-700  mb-4">{t("chartTokensTrend")}</h3>
          {series.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-ui-caption text-neutral-600">{t("chartEmptyRange")}</div>
          ) : (
            <RequestsTrendChart data={series} />
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-neutral-200 bg-white   p-5 shadow-none">
            <h3 className="text-ui-body font-semibold text-neutral-700  mb-4">{t("chartModelTokens")}</h3>
            {byModel.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center text-ui-caption text-neutral-600">{t("chartEmpty")}</div>
            ) : (
              <ModelTokensChart data={byModel} />
            )}
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white   p-5 shadow-none">
            <h3 className="text-ui-body font-semibold text-neutral-700  mb-4">{t("chartCallsDistribution")}</h3>
            {byModel.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center text-ui-caption text-neutral-600">{t("chartEmpty")}</div>
            ) : (
              <ModelCallsPie data={byModel} />
            )}
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white   p-5 shadow-none">
          <h3 className="text-ui-body font-semibold text-neutral-700  mb-4">{t("chartSourceDistribution")}</h3>
          {bySource.length === 0 ? (
            <div className="h-[180px] flex items-center justify-center text-ui-caption text-neutral-600">{t("chartEmpty")}</div>
          ) : (
            <SourceBar data={bySource} />
          )}
        </div>
      </div>
      )}
    </div>
  );
}
