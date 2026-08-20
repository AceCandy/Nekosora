"use client";

import { clsx } from "clsx";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { MetricData, MetricItem } from "./schema";

/** 趋势标记 → 方向族(箭头+涨跌色)或程度族(色点+品牌蓝深浅,不暗示涨跌)。 */
const TREND_STYLES = {
  // 方向族
  up: { Icon: ArrowUp, className: "text-success " },
  down: { Icon: ArrowDown, className: "text-rose-600 " },
  flat: { Icon: Minus, className: "text-neutral-400 " },
  // 程度族:概率 / 强度类指标常用 high/medium/low,用色点区分、避免误导为涨跌方向
  high: { dot: "bg-sora-blue", className: "text-sora-blue" },
  medium: { dot: "bg-sora-blue/50", className: "text-sora-blue/70" },
  low: { dot: "bg-neutral-400 ", className: "text-neutral-400 " },
} as const;

/** 单值指标卡片：label + value + 单位 + 趋势方向 + 变化量。 */
function MetricCard({ item }: { item: MetricItem }) {
  const trend = item.trend ? TREND_STYLES[item.trend] : null;
  return (
    <div className="inline-flex flex-col gap-1 rounded-lg border border-morning-mist  bg-nebula-white  px-4 py-3">
      <span className="text-ui-caption text-neutral-500 ">{item.label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-ui-heading font-semibold text-space-ink  tabular-nums">
          {String(item.value)}
        </span>
        {item.unit ? (
          <span className="text-ui-body text-neutral-500 ">{item.unit}</span>
        ) : null}
        {trend ? (
          "dot" in trend ? (
            <span className={clsx("inline-block w-2 h-2 rounded-full self-center", trend.dot)} aria-hidden="true" />
          ) : (
            <trend.Icon className={clsx("w-4 h-4 self-center", trend.className)} aria-hidden="true" />
          )
        ) : null}
        {item.delta ? (
          <span className={clsx("text-ui-caption", trend?.className ?? "text-neutral-500 ")}>
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
