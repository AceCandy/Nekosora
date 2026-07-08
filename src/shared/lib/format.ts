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
 * 时间按浏览器时区呈现(修复日志时间显示成 UTC 的问题)。
 *
 * 传入 ISO 字符串(带 Z 的 UTC instant),用 toLocaleString 走浏览器本地时区,
 * 固定年月日 + 时分组件、24 小时制。NaN 兜底返回原值。
 */
export function formatDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
