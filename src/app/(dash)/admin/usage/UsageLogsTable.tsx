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
  latencyMs: number | null;
  firstTokenLatencyMs: number | null;
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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // 固定格式,避免 locale 差异:YYYY-MM-DD HH:mm
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
                <th className="text-left px-4 py-3">{t("thProvider")}</th>
                <th className="text-left px-4 py-3">{t("thRoute")}</th>
                <th className="text-left px-4 py-3">{t("thUpstreamModel")}</th>
                <th className="text-right px-4 py-3">{t("thTotalTokens")}</th>
                <th className="text-right px-4 py-3">{t("thLatency")}</th>
                <th className="text-right px-4 py-3">{t("thTtft")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-neutral-400 dark:text-neutral-500">
                    {t("emptyLogs")}
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const providerDisplay = r.providerName ?? r.providerRef ?? "-";
                return (
                  <tr
                    key={r.id}
                    className="hover:bg-neutral-50/30 dark:hover:bg-neutral-900/10 transition-colors duration-150"
                  >
                    <td className="px-4 py-3 font-mono text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-neutral-700 dark:text-neutral-300">
                      {t(`sources.${r.source}` as const)}
                    </td>
                    <td className="px-4 py-3 font-mono text-neutral-900 dark:text-white">{r.model}</td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400 max-w-[160px] truncate">
                      {providerDisplay}
                    </td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400 max-w-[180px] truncate">
                      {r.routeName ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400 max-w-[160px] truncate">
                      {r.upstreamModel ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-neutral-800 dark:text-neutral-200">
                      {(r.promptTokens + r.completionTokens).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-neutral-500 dark:text-neutral-400">
                      {r.latencyMs != null ? `${r.latencyMs}ms` : "-"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-neutral-500 dark:text-neutral-400">
                      {r.firstTokenLatencyMs != null ? `${r.firstTokenLatencyMs}ms` : "-"}
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
