"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDownToLine, ArrowUpFromLine, Bot, Clock3, Database } from "lucide-react";
import { clsx } from "clsx";
import type { MessageRunMetadata } from "@/features/chat/model/types";
import { formatDuration } from "@/shared/lib/format";

/** 单个诊断徽标:圆角浅底 chip,icon + 短标签 + 等宽数值(DEEIX message-meta 式克制形态)。 */
const BADGE_CLASS = "inline-flex min-w-0 items-center gap-1 rounded-md bg-nebula-silver/40 px-1.5 py-0.5";

interface RunMetadataFieldsProps {
  metadata: MessageRunMetadata;
  className?: string;
}

/** 以固定顺序投影真实可用字段；未知值隐藏，数值 0 保留。 */
export function RunMetadataFields({ metadata, className }: RunMetadataFieldsProps) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const model = metadata.model?.trim();
  const tokenItems = [
    {
      key: "input",
      label: t("inputTokens"),
      value: metadata.tokenUsage?.promptTokens,
      Icon: ArrowDownToLine,
    },
    {
      key: "cache",
      label: t("cacheReadTokens"),
      value: metadata.tokenUsage?.cacheReadTokens,
      Icon: Database,
    },
    {
      key: "output",
      label: t("outputTokens"),
      value: metadata.tokenUsage?.completionTokens,
      Icon: ArrowUpFromLine,
    },
  ];

  return (
    <dl
      className={clsx(
        "flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 text-ui-micro text-ink-tertiary ",
        className,
      )}
    >
      {model && (
        <div className={clsx(BADGE_CLASS, "max-w-full")} title={model}>
          <dt className="inline-flex shrink-0 items-center gap-1">
            <Bot className="size-2.5" aria-hidden="true" />
            <span>{t("responseModel")}</span>
          </dt>
          <dd
            className="min-w-0 max-w-[min(18rem,60vw)] truncate font-mono tabular-nums text-ink-tertiary "
          >
            {model}
          </dd>
        </div>
      )}
      {tokenItems.map(({ key, label, value, Icon }) => (
        typeof value === "number" ? (
          <div key={key} className={BADGE_CLASS} title={label}>
            <dt className="inline-flex items-center gap-1">
              <Icon className="size-2.5" aria-hidden="true" />
              <span>{label}</span>
            </dt>
            <dd className="font-mono tabular-nums text-ink-tertiary ">
              {value.toLocaleString(locale)}
            </dd>
          </div>
        ) : null
      ))}
      {typeof metadata.durationMs === "number" && (
        <div className={BADGE_CLASS} title={t("responseDuration")}>
          <dt className="inline-flex items-center gap-1">
            <Clock3 className="size-2.5" aria-hidden="true" />
            <span>{t("responseDuration")}</span>
          </dt>
          <dd className="font-mono tabular-nums text-ink-tertiary ">
            {formatDuration(metadata.durationMs)}
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * 实时计时:前 10s 用 requestAnimationFrame 走表(跟随帧率,视觉连续),
 * 之后降为每秒一次 setInterval,长跑请求省电且数值仍准。
 */
function useLiveElapsedMs(startedAt: string): number {
  const startMs = Date.parse(startedAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(startMs)) return;
    let raf = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      raf = 0;
      setNow(Date.now());
      if (Date.now() - startMs < 10_000) raf = requestAnimationFrame(tick);
      else timer = setInterval(() => setNow(Date.now()), 1000);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearInterval(timer);
    };
  }, [startMs]);
  return Number.isFinite(startMs) ? Math.max(0, now - startMs) : 0;
}

/** 流式期间的实时耗时徽标:star 蓝底 chip + 走表数字,让等待可视;流结束由耗时徽标接替。 */
export function LiveLatencyBadge({ startedAt }: { startedAt: string }) {
  const t = useTranslations("chat");
  const elapsed = useLiveElapsedMs(startedAt);
  return (
    <span
      className="inline-flex w-fit items-center gap-1 rounded-md bg-sora-blue/[0.07] px-1.5 py-0.5 font-mono text-ui-micro tabular-nums text-sora-blue"
      title={t("responseDuration")}
      aria-label={t("responseDuration")}
    >
      <Clock3 className="size-2.5" aria-hidden="true" />
      {formatDuration(elapsed)}
    </span>
  );
}
