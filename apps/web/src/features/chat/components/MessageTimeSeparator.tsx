"use client";

import { memo, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getMessageTimeSeparatorInfo } from "@/features/chat/model/messageTime";

interface MessageTimeSeparatorProps {
  createdAt?: string;
  previousCreatedAt?: string;
  isFirst: boolean;
}

const emptySubscribe = () => () => {};

function readBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
}

/** 在 hydration 后按访问者本地时区渲染消息时间分隔。 */
export const MessageTimeSeparator = memo(function MessageTimeSeparator({
  createdAt,
  previousCreatedAt,
  isFirst,
}: MessageTimeSeparatorProps) {
  const locale = useLocale();
  const t = useTranslations("chat");
  const timeZone = useSyncExternalStore(emptySubscribe, readBrowserTimeZone, () => "");
  if (!timeZone) return null;

  const info = getMessageTimeSeparatorInfo({
    createdAt,
    previousCreatedAt,
    isFirst,
    now: new Date(),
    locale,
    timeZone,
  });
  if (!info) return null;

  const label = info.kind === "yesterday"
    ? `${t("groupYesterday")} ${info.time}`
    : info.kind === "dayBeforeYesterday"
      ? `${t("groupDayBeforeYesterday")} ${info.time}`
      : info.kind === "today"
        ? info.time
        : `${info.date} ${info.time}`;

  return (
    <time
      dateTime={info.dateTime}
      className="mb-4 block text-center text-ui-micro text-neutral-500 "
    >
      {label}
    </time>
  );
});
