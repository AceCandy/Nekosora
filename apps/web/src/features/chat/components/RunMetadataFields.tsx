"use client";

import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import type { MessageRunMetadata } from "@/features/chat/model/types";
import { formatDuration } from "@/shared/lib/format";

interface RunMetadataFieldsProps {
  metadata: MessageRunMetadata;
  className?: string;
}

/**
 * 元数据收敛为单行纯文本签名:模型 · 耗时 · in→out tokens(· 缓存)。
 * 零值/缺失字段整段省略,数字走 ICU 本地化格式化,不再渲染 chip 阵列。
 */
export function RunMetadataFields({ metadata, className }: RunMetadataFieldsProps) {
  const t = useTranslations("chat");
  const model = metadata.model?.trim();
  const prompt = metadata.tokenUsage?.promptTokens;
  const completion = metadata.tokenUsage?.completionTokens;
  const cache = metadata.tokenUsage?.cacheReadTokens;

  const parts: string[] = [];
  if (model) parts.push(model);
  if (typeof metadata.durationMs === "number") parts.push(formatDuration(metadata.durationMs));
  if (
    typeof prompt === "number"
    && typeof completion === "number"
    && (prompt > 0 || completion > 0)
  ) {
    parts.push(t("tokensCompact", { input: prompt, output: completion }));
  }
  if (typeof cache === "number" && cache > 0) parts.push(t("cacheCompact", { count: cache }));

  if (parts.length === 0) return null;
  const signature = parts.join(" · ");
  return (
    <p
      className={clsx(
        "min-w-0 max-w-full truncate font-mono text-ui-micro tabular-nums text-ink-tertiary",
        className,
      )}
      title={signature}
    >
      {signature}
    </p>
  );
}
