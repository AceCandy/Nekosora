"use client";

import { clsx } from "clsx";
import { AlertTriangle, Lightbulb, Info, AlertOctagon } from "lucide-react";
import type { CalloutData } from "./schema";

/** 类型 → 图标 + 语义强调色。仅图标与标题着色,背景保持中性,避免彩色侧条的 AI 模板痕迹。 */
const CALLOUT_STYLES = {
  warning: { Icon: AlertTriangle, accent: "text-amber-600 dark:text-amber-400" },
  tip: { Icon: Lightbulb, accent: "text-emerald-600 dark:text-emerald-400" },
  note: { Icon: Info, accent: "text-sora-blue" },
  error: { Icon: AlertOctagon, accent: "text-rose-600 dark:text-rose-400" },
} as const;

/** 强调提示卡:类型图标 + 可选标题 + 正文,中性背景 + 类型强调色。 */
export function CalloutBlock({ data }: { data: CalloutData }) {
  const style = CALLOUT_STYLES[data.type];
  return (
    <div className="my-2 flex gap-2.5 rounded-lg border border-morning-mist dark:border-deep-space/60 bg-morning-mist/40 dark:bg-deep-space/20 px-4 py-3">
      <style.Icon className={clsx("mt-0.5 h-4 w-4 shrink-0", style.accent)} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {data.title ? (
          <div className={clsx("text-sm font-medium", style.accent)}>{data.title}</div>
        ) : null}
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
          {data.body}
        </div>
      </div>
    </div>
  );
}
