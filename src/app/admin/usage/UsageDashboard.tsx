"use client";
/**
 * 用量仪表盘 —— 含时间范围切换器 + 总量卡片 + 三张图表。
 * 范围切换通过更新 URL query 触发 server 重新渲染。
 */
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { clsx } from "clsx";
import {
  RequestsTrendChart, ModelTokensChart, ModelCallsPie, SourceBar,
} from "./UsageCharts";
import type { TimeRange } from "@/lib/usage-aggregate";
import type { TimeSeriesPoint, ModelRow, SourceRow } from "./UsageCharts";

const RANGES: { value: TimeRange; label: string }[] = [
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
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
        <MetricCard label="累计调用" value={totals.calls.toLocaleString()} hint="全部时间" />
        <MetricCard label="累计输入 Tokens" value={totals.promptTokens.toLocaleString()} hint="全部时间" />
        <MetricCard label="累计输出 Tokens" value={totals.completionTokens.toLocaleString()} hint="全部时间" />
      </div>

      {/* 范围选择器 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-400 dark:text-neutral-500 mr-1">时间范围:</span>
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
            {r.label}
          </button>
        ))}
      </div>

      {/* 图表网格 */}
      <div className="space-y-4">
        <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 shadow-none">
          <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 mb-4">Token 消耗趋势(堆叠面积)</h3>
          {series.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-xs text-neutral-400">所选范围暂无数据</div>
          ) : (
            <RequestsTrendChart data={series} />
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 shadow-none">
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 mb-4">各模型 Token 消耗(Top 6)</h3>
            {byModel.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center text-xs text-neutral-400">暂无数据</div>
            ) : (
              <ModelTokensChart data={byModel} />
            )}
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 shadow-none">
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 mb-4">模型调用分布</h3>
            {byModel.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center text-xs text-neutral-400">暂无数据</div>
            ) : (
              <ModelCallsPie data={byModel} />
            )}
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 shadow-none">
          <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 mb-4">来源分布(Chat / Gateway)</h3>
          {bySource.length === 0 ? (
            <div className="h-[180px] flex items-center justify-center text-xs text-neutral-400">暂无数据</div>
          ) : (
            <SourceBar data={bySource} />
          )}
        </div>
      </div>
    </div>
  );
}
