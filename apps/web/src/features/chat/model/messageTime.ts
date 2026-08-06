export { toMessageCreatedAtIso } from "@nekusora/contracts/chat";

type MessageTimeKind =
  | "today"
  | "yesterday"
  | "dayBeforeYesterday"
  | "thisYear"
  | "otherYear";

interface MessageTimeSeparatorOptions {
  createdAt?: string;
  previousCreatedAt?: string;
  isFirst: boolean;
  now: Date;
  locale: string;
  timeZone: string;
}

interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

interface MessageTimeSeparatorBase {
  dateTime: string;
  kind: MessageTimeKind;
  time: string;
  date?: string;
}

export type MessageTimeSeparatorInfo = MessageTimeSeparatorBase;

function calendarDay(date: Date, formatter: Intl.DateTimeFormat): CalendarDay | null {
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (![year, month, day].every(Number.isFinite)) return null;
  return { year, month, day };
}

function dayOrdinal(value: CalendarDay): number {
  return Date.UTC(value.year, value.month - 1, value.day) / 86_400_000;
}

/** 按指定时区决定消息前是否需要时间分隔，并返回本地化所需的展示信息。 */
export function getMessageTimeSeparatorInfo({
  createdAt,
  previousCreatedAt,
  isFirst,
  now,
  locale,
  timeZone,
}: MessageTimeSeparatorOptions): MessageTimeSeparatorInfo | null {
  if (!createdAt || !Number.isFinite(now.getTime())) return null;
  const created = new Date(createdAt);
  if (!Number.isFinite(created.getTime())) return null;

  try {
    const dayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      numberingSystem: "latn",
    });
    const createdDay = calendarDay(created, dayFormatter);
    const nowDay = calendarDay(now, dayFormatter);
    if (!createdDay || !nowDay) return null;

    if (isFirst) {
      if (dayOrdinal(createdDay) === dayOrdinal(nowDay)) return null;
    } else {
      if (!previousCreatedAt) return null;
      const previous = new Date(previousCreatedAt);
      if (!Number.isFinite(previous.getTime())) return null;
      const previousDay = calendarDay(previous, dayFormatter);
      if (!previousDay || dayOrdinal(previousDay) === dayOrdinal(createdDay)) return null;
    }

    const difference = dayOrdinal(nowDay) - dayOrdinal(createdDay);
    const time = new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(created);
    const base = { dateTime: created.toISOString(), time };

    if (difference === 0) return { ...base, kind: "today" };
    if (difference === 1) return { ...base, kind: "yesterday" };
    if (difference === 2) return { ...base, kind: "dayBeforeYesterday" };

    if (createdDay.year === nowDay.year) {
      return {
        ...base,
        kind: "thisYear",
        date: new Intl.DateTimeFormat(locale, {
          timeZone,
          month: "long",
          day: "numeric",
        }).format(created),
      };
    }

    return {
      ...base,
      kind: "otherYear",
      date: new Intl.DateTimeFormat(locale, {
        timeZone,
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(created),
    };
  } catch {
    return null;
  }
}
