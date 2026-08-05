"use client";

import { useLocale, useTranslations } from "next-intl";
import { ArrowDownToLine, ArrowUpFromLine, Bot, Clock3, Database } from "lucide-react";
import { clsx } from "clsx";
import type { MessageRunMetadata } from "@/features/chat/model/types";
import { formatDuration } from "@/shared/lib/format";

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
        "flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-ui-micro text-space-ink/50 dark:text-nebula-silver/50",
        className,
      )}
    >
      {model && (
        <div className="inline-flex min-w-0 max-w-full items-center gap-1">
          <dt className="inline-flex shrink-0 items-center gap-1">
            <Bot className="size-2.5" aria-hidden="true" />
            <span>{t("responseModel")}</span>
          </dt>
          <dd
            className="min-w-0 max-w-[min(18rem,60vw)] truncate text-space-ink/55 dark:text-nebula-silver/55"
            title={model}
          >
            {model}
          </dd>
        </div>
      )}
      {tokenItems.map(({ key, label, value, Icon }) => (
        typeof value === "number" ? (
          <div key={key} className="inline-flex items-center gap-1">
            <dt className="inline-flex items-center gap-1">
              <Icon className="size-2.5" aria-hidden="true" />
              <span>{label}</span>
            </dt>
            <dd className="font-mono tabular-nums text-space-ink/55 dark:text-nebula-silver/55">
              {value.toLocaleString(locale)}
            </dd>
          </div>
        ) : null
      ))}
      {typeof metadata.durationMs === "number" && (
        <div className="inline-flex items-center gap-1">
          <dt className="inline-flex items-center gap-1">
            <Clock3 className="size-2.5" aria-hidden="true" />
            <span>{t("responseDuration")}</span>
          </dt>
          <dd className="font-mono tabular-nums text-space-ink/55 dark:text-nebula-silver/55">
            {formatDuration(metadata.durationMs)}
          </dd>
        </div>
      )}
    </dl>
  );
}
