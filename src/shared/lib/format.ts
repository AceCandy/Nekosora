/**
 * 通用展示格式化工具 —— 耗时自适应单位 + 时间跟随浏览器时区。
 *
 * 用量明细 / 错误请求表共用,确保 latency/TTFT 与 createdAt 跨组件一致呈现。
 */

/**
 * 耗时自适应格式:ms → ms / s / m / h。
 * null / undefined → "-"(列对齐占位)。
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/**
 * 时间呈现:固定 locale(zh-CN) + timeZone(Asia/Shanghai),确保 SSR/client 输出一致(杜绝 hydration)。
 *
 * createdAt 为 PG timestamp(with time zone)(drizzle withTimezone),defaultNow() 存 UTC,
 * pg 驱动读出 epoch 正确;按 Asia/Shanghai 转换即东八展示时间。NaN 兜底返回原值。
 */
export function formatDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
