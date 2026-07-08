"use client";
/**
 * 用量明细表(Client Component)—— 成功计费调用明细。
 *
 * admin / panel 共用:数据由服务端查询后注入(page 控制是否按 userId 隔离)。
 * 包含:筛选栏(model/provider/route/source)+ 表格(providerName 可读名,
 * 缺失降级 providerRef)+ 分页。createdAt 在服务端已转 ISO 字符串以便跨边界传递。
 */
import { useTranslations } from "next-intl";
import { Pagination } from "@/shared/ui/Pagination";
import { formatDateTimeLocal, formatDuration } from "@/shared/lib/format";
import { UsageFilters, type FilterField } from "./UsageFilters";

/** 客户端行类型(createdAt 已序列化为 ISO 字符串)。 */
export interface UsageLogClientRow {
  id: string;
  source: string;
  model: string;
  providerRef: string | null;
  providerName: string | null;
  routeName: string | null;
  upstreamModel: string | null;
  promptTokens: number;
  completionTokens: number;
  /** 缓存读取 token(prompt cache 命中)。 */
  cacheReadTokens: number;
  latencyMs: number | null;
  firstTokenLatencyMs: number | null;
  /** 命中的对外网关 key 名(panel 用量明细可见;错误视图脱敏置空)。 */
  apiKeyName: string | null;
  /** 命中上游 key 的脱敏快照(仅 admin 可见;panel 不下发)。 */
  upstreamKeyMasked: string | null;
  createdAt: string;
}

interface UsageLogsTableProps {
  rows: UsageLogClientRow[];
  total: number;
  page: number;
  pageSize: number;
  /** 当前已应用筛选(来自 searchParams)。 */
  filterValues: Record<string, string>;
  basePath: string;
  /** 切换筛选/翻页时保留的 query(tab)。 */
  preservedParams: Record<string, string | undefined>;
}

export function UsageLogsTable({
  rows,
  total,
  page,
  pageSize,
  filterValues,
  basePath,
  preservedParams,
}: UsageLogsTableProps) {
  const t = useTranslations("admin.usage");

  const fields: FilterField[] = [
    { name: "model", label: t("filters.model"), type: "text", placeholder: "gpt-4o" },
    { name: "provider", label: t("filters.provider"), type: "text" },
    { name: "route", label: t("filters.route"), type: "text" },
    {
      name: "source",
      label: t("filters.source"),
      type: "select",
      widthClass: "w-28",
      options: [
        { value: "", label: t("rangeAll") },
        { value: "chat", label: t("sources.chat") },
        { value: "gateway", label: t("sources.gateway") },
      ],
    },
  ];

  const buildPageHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(preservedParams)) if (v) params.set(k, v);
    for (const [k, v] of Object.entries(filterValues)) if (v) params.set(k, v);
    params.set("page", String(p));
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="space-y-3">
      <UsageFilters
        fields={fields}
        values={filterValues}
        basePath={basePath}
        preservedParams={preservedParams}
        applyLabel={t("apply")}
        resetLabel={t("reset")}
      />

      <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] overflow-hidden shadow-none transition-all duration-200">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-neutral-50/70 border-b border-neutral-200 text-neutral-500 dark:bg-neutral-900/50 dark:border-neutral-800 dark:text-neutral-400 uppercase tracking-wider font-semibold">
                <th className="text-left px-4 py-3">{t("thCreatedAt")}</th>
                <th className="text-left px-4 py-3">{t("thSource")}</th>
                <th className="text-left px-4 py-3">{t("thModel")}</th>
                <th className="text-left px-4 py-3">{t("thRoute")}</th>
                <th className="text-left px-4 py-3">{t("thKey")}</th>
                <th className="text-right px-4 py-3">{t("thInput")}</th>
                <th className="text-right px-4 py-3">{t("thOutput")}</th>
                <th className="text-right px-4 py-3">{t("thCacheRead")}</th>
                <th className="text-right px-4 py-3">{t("thLatency")}</th>
                <th className="text-right px-4 py-3">{t("thTtft")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-neutral-400 dark:text-neutral-500">
                    {t("emptyLogs")}
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                return (
                  <tr
                    key={r.id}
                    className="hover:bg-neutral-50/30 dark:hover:bg-neutral-900/10 transition-colors duration-150"
                  >
                    <td className="px-4 py-3 font-mono text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                      {formatDateTimeLocal(r.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-neutral-700 dark:text-neutral-300">
                      {t(`sources.${r.source}` as const)}
                    </td>
                    <td className="px-4 py-3 font-mono text-neutral-900 dark:text-white">{r.model}</td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400 max-w-[220px] truncate">
                      {r.routeName ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-neutral-700 dark:text-neutral-300 truncate max-w-[180px]">
                          {r.apiKeyName ?? "-"}
                        </span>
                        {r.upstreamKeyMasked && (
                          <span className="font-mono text-[10px] text-neutral-400 dark:text-neutral-500 truncate max-w-[180px]">
                            {r.upstreamKeyMasked}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-neutral-800 dark:text-neutral-200">
                      {r.promptTokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-neutral-800 dark:text-neutral-200">
                      {r.completionTokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-neutral-500 dark:text-neutral-400">
                      {r.cacheReadTokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-neutral-500 dark:text-neutral-400">
                      {formatDuration(r.latencyMs)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-neutral-500 dark:text-neutral-400">
                      {formatDuration(r.firstTokenLatencyMs)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        buildHref={buildPageHref}
        labels={{
          prev: t("pagination.prev"),
          next: t("pagination.next"),
          summary: t("pagination.summary", { page, totalPages: Math.max(1, Math.ceil(total / pageSize)), total }),
        }}
      />
    </div>
  );
}

export default UsageLogsTable;
