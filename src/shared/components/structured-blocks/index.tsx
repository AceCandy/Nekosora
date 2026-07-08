"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { clsx } from "clsx";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CalloutData, ChartData, MetricData, StructuredKind, StructuredParseResult, TableData } from "./schema";
import { parsePartialMetricItems, parseStructured } from "./schema";
import { MetricBlock } from "./MetricBlock";
import { TableBlock } from "./TableBlock";
import { CalloutBlock } from "./CalloutBlock";
import { copyToClipboard } from "@/shared/lib/clipboard";

/** recharts 体积大，按需动态加载、关闭 SSR，避免打入消息首屏 bundle。 */
const ChartBlock = dynamic(() => import("./ChartBlock").then((m) => m.ChartBlock), {
  ssr: false,
  loading: () => <SkeletonBlock kind="chart" />,
});

/** 结构化块骨架占位：流式期与 chart 异步加载期统一显示。 */
export function SkeletonBlock({ kind }: { kind?: StructuredKind }) {
  const shape = kind === "metric" ? "h-20 w-48" : kind === "callout" ? "h-16 w-full" : "h-64 w-full";
  return (
    <div
      className={clsx("my-2 animate-pulse rounded-lg bg-morning-mist/60 dark:bg-deep-space/40", shape)}
      role="status"
      aria-label="加载中"
    />
  );
}

type ParsedStructured = Extract<StructuredParseResult, { ok: true }>;

/** 结构化块渲染路由：只处理校验成功的 result，按 kind 分发到具体组件。 */
export function StructuredBlock({ result }: { result: ParsedStructured }) {
  if (result.kind === "chart") return <ChartBlock data={result.data as ChartData} />;
  if (result.kind === "metric") return <MetricBlock data={result.data as MetricData} />;
  if (result.kind === "callout") return <CalloutBlock data={result.data as CalloutData} />;
  return <TableBlock data={result.data as TableData} />;
}

/**
 * 结构化代码块的内联视图：集中「骨架 → 受控组件 + 复制 → 解析失败降级源码」三态。
 * streamdown 的自定义 pre 组件与 custom 渲染器的分段混合渲染共用本组件，
 * 避免两处入口重复实现复制按钮与降级角标。
 */
export function StructuredInlineView({
  kind,
  raw,
  isStreaming = false,
}: {
  kind: StructuredKind;
  raw: string;
  isStreaming?: boolean;
}) {
  const t = useTranslations("artifacts");
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const result = parseStructured(kind, raw);

  // 流式渐进:metric 数组支持块内增量,从未闭合的半截 JSON 切出已完成的指标项逐张渲染;
  // 其余结构走「闭合即渲染」。切不出完整项或块未闭合时静默骨架,不报错闪烁。
  // 流式态不显示复制按钮(内容仍在变)。
  if (isStreaming) {
    if (kind === "metric") {
      const items = parsePartialMetricItems(raw);
      if (items.length > 0) return <MetricBlock data={items} />;
    }
    return result.ok ? <StructuredBlock result={result} /> : <SkeletonBlock kind={kind} />;
  }

  async function handleCopy() {
    const ok = await copyToClipboard(raw);
    if (!ok) return;
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1400);
  }

  // 解析成功：正文内联渲染 + 复制原始 JSON。
  if (result.ok) {
    return (
      <div className="group relative">
        <div className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md bg-white/80 dark:bg-space-ink/80 px-1 py-1 backdrop-blur-sm opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-950/5 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
            title={copied ? t("copied") : t("copy")}
            aria-label={copied ? t("copied") : t("copy")}
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-500" aria-hidden="true" />
            ) : (
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
        <StructuredBlock result={result} />
      </div>
    );
  }

  // 解析失败：降级为源码展示 + 失败角标。
  return (
    <div className="relative">
      <span
        className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-md bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-400"
        title={t("structuredParseFailed")}
      >
        <AlertTriangle className="w-3 h-3" aria-hidden="true" />
        {t("structuredParseFailed")}
      </span>
      <pre className="overflow-x-auto rounded-lg bg-neutral-50 dark:bg-deep-space/60 p-3 text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
        <code>{raw}</code>
      </pre>
    </div>
  );
}
