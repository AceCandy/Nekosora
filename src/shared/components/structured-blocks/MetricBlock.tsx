"use client";

import { clsx } from "clsx";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { MetricData, MetricItem } from "./schema";

/** 趋势方向 → 图标 + 语义色（涨绿 / 跌红 / 平灰）。 */
const TREND_STYLES = {
  up: { Icon: ArrowUp, className: "text-emerald-600 dark:text-emerald-400" },
  down: { Icon: ArrowDown, className: "text-rose-600 dark:text-rose-400" },
  flat: { Icon: Minus, className: "text-neutral-400 dark:text-neutral-500" },
} as const;

/** 单值指标卡片：label + value + 单位 + 趋势方向 + 变化量。 */
function MetricCard({ item }: { item: MetricItem }) {
  const trend = item.trend ? TREND_STYLES[item.trend] : null;
  return (
    <div className="inline-flex flex-col gap-1 rounded-lg border border-morning-mist dark:border-deep-space/70 bg-nebula-white dark:bg-twilight-obsidian px-4 py-3">
      <span className="text-xs text-neutral-500 dark:text-neutral-400">{item.label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold text-space-ink dark:text-nebula-silver tabular-nums">
          {String(item.value)}
        </span>
        {item.unit ? (
          <span className="text-sm text-neutral-500 dark:text-neutral-400">{item.unit}</span>
        ) : null}
        {trend ? <trend.Icon className={clsx("w-4 h-4 self-center", trend.className)} aria-hidden="true" /> : null}
        {item.delta ? (
          <span className={clsx("text-xs", trend?.className ?? "text-neutral-500 dark:text-neutral-400")}>
            {item.delta}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 指标卡容器：schema 允许单对象或数组，统一规整为数组后横排渲染。
 * 单指标时退化为一张卡，视觉与历史一致。
 */
export function MetricBlock({ data }: { data: MetricData }) {
  const items: MetricItem[] = Array.isArray(data) ? data : [data];
  return (
    <div className="flex flex-wrap gap-2 my-2">
      {items.map((item, i) => (
        <MetricCard key={i} item={item} />
      ))}
    </div>
  );
}
