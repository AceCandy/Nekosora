"use client";
/**
 * 时间范围选择 —— 预设按钮 + 自定义起止(date input)。
 * 预设:今天/昨天/24小时/7天/30天;自定义:两个 date input。
 * 受控(range/start/end)+ onChange(patch) → 由父组件(UsageFilterBar)更新 URL。
 */
import { useTranslations } from "next-intl";
import { clsx } from "clsx";

interface DateRangePickerProps {
  /** 预设值 today/yesterday/24h/7d/30d;自定义时为空。 */
  range: string;
  /** 自定义起(YYYY-MM-DD)。 */
  start?: string;
  /** 自定义止(YYYY-MM-DD)。 */
  end?: string;
  onChange: (patch: { range?: string; start?: string; end?: string }) => void;
}

const PRESETS = [
  { value: "today", key: "rangeToday" },
  { value: "yesterday", key: "rangeYesterday" },
  { value: "24h", key: "range24h" },
  { value: "7d", key: "range7d" },
  { value: "30d", key: "range30d" },
] as const;

export function DateRangePicker({ range, start, end, onChange }: DateRangePickerProps) {
  const t = useTranslations("admin.usage");
  const isCustom = range === "custom";

  return (
    <div className="flex flex-col gap-1">
      <span className="text-ui-caption text-neutral-400 dark:text-neutral-500">{t("filters.range")}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange({ range: p.value, start: "", end: "" })}
            className={clsx(
              "px-2 py-1 rounded text-ui-caption border transition-colors",
              range === p.value
                ? "bg-sora-blue/8 text-sora-blue border-sora-blue/30 dark:bg-sora-blue/10"
                : "bg-white dark:bg-[#12141a] text-neutral-500 border-neutral-200 dark:border-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-300",
            )}
          >
            {t(p.key)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange({ range: "custom" })}
          className={clsx(
            "px-2 py-1 rounded text-ui-caption border transition-colors",
            isCustom
              ? "bg-sora-blue/8 text-sora-blue border-sora-blue/30 dark:bg-sora-blue/10"
              : "bg-white dark:bg-[#12141a] text-neutral-500 border-neutral-200 dark:border-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-300",
          )}
        >
          {t("rangeCustom")}
        </button>
      </div>
      {isCustom && (
        <div className="flex items-center gap-1.5 mt-0.5">
          <input
            type="date"
            value={start ?? ""}
            onChange={(e) => onChange({ start: e.target.value, end: end ?? "" })}
            className="px-1.5 py-1 text-ui-caption rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#12141a] text-neutral-700 dark:text-neutral-300"
          />
          <span className="text-ui-caption text-neutral-400">~</span>
          <input
            type="date"
            value={end ?? ""}
            onChange={(e) => onChange({ start: start ?? "", end: e.target.value })}
            className="px-1.5 py-1 text-ui-caption rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#12141a] text-neutral-700 dark:text-neutral-300"
          />
        </div>
      )}
    </div>
  );
}

export default DateRangePicker;
