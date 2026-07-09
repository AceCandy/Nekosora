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
 * 时间按固定东八区(Asia/Shanghai)呈现。
 *
 * 固定 locale(zh-CN) + 固定时区,确保 SSR 与 client 输出完全一致——
 * 若用浏览器 locale/timeZone(toLocaleString(undefined)),服务端(Node 默认 en-US)
 * 与客户端(浏览器 zh-CN)格式不同(如 07/09/2026 vs 2026/07/09)会触发 React
 * hydration mismatch。固定后两者恒等,杜绝该报错。NaN 兜底返回原值。
 *
 * 注:真正"跟随浏览器时区"在 SSR 下必然 hydration 冲突,需改 client-only 渲染
 * (SSR 占位、mount 后替换)。当前固定东八区最稳,符合产品主面向国内。
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
