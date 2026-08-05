/**
 * 用量页时间范围解析(共享:admin + panel)。
 *
 * 支持预设(today/yesterday/24h/7d/30d)+ 自定义起止(start/end)。
 * 返回列表过滤用的 startAt/endAt + 图表 bucket 粒度 chartRange。默认今天。
 */
import type { TimeRange } from "@/lib/usage-aggregate";

/** admin 用户筛选「全部」内部哨兵(不在下拉显示);×清空时写入,查询不限定 userId。 */
export const ALL_USERS = "__all__";

export function strParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * 解析用量页的有效 userId(数据隔离收敛点,服务端强制)。
 * - admin 无 user:默认查自己(selfId),配合筛选框回填自己
 * - admin + user=__all__:查全部(undefined)
 * - admin + user=<id>:查指定用户
 * - 普通用户:强制查自己(selfId),忽略 userParam 防越权。
 */
export function resolveEffectiveUserId(opts: {
  isAdmin: boolean;
  userParam?: string;
  selfId: string;
}): string | undefined {
  if (opts.isAdmin && opts.userParam === ALL_USERS) return undefined;
  if (opts.isAdmin && opts.userParam) return opts.userParam;
  return opts.selfId;
}

/** 自定义起止跨度 → 图表 bucket 粒度。 */
export function inferChartRange(startAt?: Date, endAt?: Date): TimeRange {
  if (!startAt || !endAt) return "7d";
  const days = (endAt.getTime() - startAt.getTime()) / 86_400_000;
  if (days <= 2) return "24h";
  if (days <= 8) return "7d";
  return "30d";
}

export interface ParsedTimeRange {
  startAt?: Date;
  endAt?: Date;
  chartRange: TimeRange;
  range: string;
  start?: string;
  end?: string;
}

/** 时间范围解析 → startAt/endAt + chartRange。默认今天。 */
export function parseTimeRange(sp: Record<string, string | string[] | undefined>): ParsedTimeRange {
  const range = strParam(sp.range) ?? "";
  const startStr = strParam(sp.start);
  const endStr = strParam(sp.end);
  const now = new Date();
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (range === "custom" || startStr || endStr) {
    const startAt = startStr ? new Date(`${startStr}T00:00:00`) : undefined;
    const endAt = endStr ? new Date(`${endStr}T23:59:59`) : undefined;
    return { startAt, endAt, chartRange: inferChartRange(startAt, endAt), range: "custom", start: startStr, end: endStr };
  }
  // createdAt 为 timestamptz(defaultNow 存 UTC),epoch 正确,无需处理时区偏移。
  // 预设区间只设 startAt:createdAt 不会有未来值,下界已足够界定;yesterday/custom 保留 endAt(明确闭区间)。
  if (range === "today") return { startAt: dayStart(now), chartRange: "24h", range };
  if (range === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return {
      startAt: dayStart(y),
      endAt: new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59),
      chartRange: "24h",
      range,
    };
  }
  if (range === "24h") return { startAt: new Date(now.getTime() - 86_400_000), chartRange: "24h", range };
  if (range === "7d") return { startAt: new Date(now.getTime() - 7 * 86_400_000), chartRange: "7d", range };
  if (range === "30d") return { startAt: new Date(now.getTime() - 30 * 86_400_000), chartRange: "30d", range };
  // 缺省 → 今天
  return { startAt: dayStart(now), chartRange: "24h", range: "today" };
}