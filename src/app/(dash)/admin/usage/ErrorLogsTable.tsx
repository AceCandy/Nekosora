"use client";
/**
 * 错误请求表(Client Component)—— ops_error_logs 列表。
 *
 * variant:
 *   - admin:全字段列 + 全字段筛选(provider/route/phase/httpStatus/source)+ 详情全量。
 *   - panel:脱敏白名单列(时间/模型/分类/HTTP/耗时)+ 轻量筛选(model/httpStatus)+ 详情脱敏。
 *
 * 错误分类(category)由服务端预先派生(error-classify)后随行下发,客户端直接用 i18n 渲染。
 * 点击行打开 ErrorDetailDrawer(本组件持有 selectedId 状态)。
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import Badge from "@/shared/ui/Badge";
import { Pagination } from "@/shared/ui/Pagination";
import { type ErrorCategory } from "@/lib/error-classify";
import { UsageFilters, type FilterField } from "./UsageFilters";
import { ErrorDetailDrawer } from "./ErrorDetailDrawer";

/**
 * 客户端行类型(createdAt 已序列化为 ISO 字符串)。
 * category 由服务端预先派生(error-classify),客户端不再需要 errorMessage 即可分类。
 * panel 视图下敏感字段(errorMessage、requestPath、provider、route、upstream、errorCode、
 * errorPhase 等)由服务端置空,绝不送达客户端,实现数据层脱敏。
 */
export interface ErrorLogClientRow {
  id: string;
  source: string;
  model: string;
  upstreamModel: string | null;
  providerName: string | null;
  providerRef: string | null;
  routeName: string | null;
  requestPath: string | null;
  httpStatus: number | null;
  errorCode: string;
  errorMessage: string | null;
  errorPhase: string | null;
  latencyMs: number | null;
  firstTokenLatencyMs: number | null;
  promptTokens: number;
  completionTokens: number;
  /** 粗分类(服务端派生,前端 i18n key 后缀)。 */
  category: ErrorCategory;
  createdAt: string;
}

interface ErrorLogsTableProps {
  rows: ErrorLogClientRow[];
  total: number;
  page: number;
  pageSize: number;
  filterValues: Record<string, string>;
  basePath: string;
  preservedParams: Record<string, string | undefined>;
  variant: "admin" | "panel";
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** httpStatus 徽标颜色(低饱和:4xx 中性偏暖、5xx 红、null 灰)。 */
function statusVariant(http: number | null): "neutral" | "warning" | "danger" {
  if (http == null) return "neutral";
  if (http >= 500) return "danger";
  if (http >= 400) return "warning";
  return "neutral";
}

export function ErrorLogsTable({
  rows,
  total,
  page,
  pageSize,
  filterValues,
  basePath,
  preservedParams,
  variant,
}: ErrorLogsTableProps) {
  const t = useTranslations("admin.usage");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const phaseOptions = [
    { value: "", label: t("rangeAll") },
    { value: "routing", label: t("errors.phases.routing") },
    { value: "upstream", label: t("errors.phases.upstream") },
    { value: "network", label: t("errors.phases.network") },
    { value: "internal", label: t("errors.phases.internal") },
    { value: "auth", label: t("errors.phases.auth") },
    { value: "request", label: t("errors.phases.request") },
  ];
  const rangeOptions = [
    { value: "", label: t("rangeAll") },
    { value: "24h", label: t("range24h") },
    { value: "7d", label: t("range7d") },
    { value: "30d", label: t("range30d") },
  ];

  const fields: FilterField[] =
    variant === "admin"
      ? [
          { name: "range", label: t("filters.range"), type: "select", widthClass: "w-28", options: rangeOptions },
          { name: "phase", label: t("filters.phase"), type: "select", widthClass: "w-32", options: phaseOptions },
          { name: "model", label: t("filters.model"), type: "text" },
          { name: "provider", label: t("filters.provider"), type: "text" },
          { name: "httpStatus", label: t("filters.httpStatus"), type: "text", widthClass: "w-24", placeholder: "500" },
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
          { name: "showAuth", label: t("filters.showAuth"), type: "checkbox" },
        ]
      : [
          { name: "range", label: t("filters.range"), type: "select", widthClass: "w-28", options: rangeOptions },
          { name: "model", label: t("filters.model"), type: "text" },
          { name: "httpStatus", label: t("filters.httpStatus"), type: "text", widthClass: "w-24", placeholder: "500" },
          { name: "showAuth", label: t("filters.showAuth"), type: "checkbox" },
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
                {variant === "admin" && <th className="text-left px-4 py-3">{t("thSource")}</th>}
                <th className="text-left px-4 py-3">{t("thModel")}</th>
                {variant === "admin" && <th className="text-left px-4 py-3">{t("thProvider")}</th>}
                {variant === "admin" && <th className="text-left px-4 py-3">{t("thRoute")}</th>}
                {variant === "admin" && <th className="text-left px-4 py-3">{t("errors.detailPhase")}</th>}
                <th className="text-left px-4 py-3">{t("errors.detailCategory")}</th>
                <th className="text-right px-4 py-3">{t("errors.detailHttpStatus")}</th>
                <th className="text-right px-4 py-3">{t("thLatency")}</th>
                <th className="text-right px-4 py-3">{t("errors.viewDetail")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={variant === "admin" ? 10 : 6} className="px-4 py-10 text-center text-neutral-400 dark:text-neutral-500">
                    {t("errors.empty")}
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const category = r.category;
                return (
                  <tr
                    key={r.id}
                    className="hover:bg-neutral-50/30 dark:hover:bg-neutral-900/10 transition-colors duration-150 cursor-pointer"
                    onClick={() => setSelectedId(r.id)}
                  >
                    <td className="px-4 py-3 font-mono text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                      {formatDateTime(r.createdAt)}
                    </td>
                    {variant === "admin" && (
                      <td className="px-4 py-3 font-mono text-neutral-700 dark:text-neutral-300">
                        {t(`sources.${r.source}` as const)}
                      </td>
                    )}
                    <td className="px-4 py-3 font-mono text-neutral-900 dark:text-white max-w-[160px] truncate">
                      {r.model}
                    </td>
                    {variant === "admin" && (
                      <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400 max-w-[150px] truncate">
                        {r.providerName ?? r.providerRef ?? "-"}
                      </td>
                    )}
                    {variant === "admin" && (
                      <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400 max-w-[180px] truncate">
                        {r.routeName ?? "-"}
                      </td>
                    )}
                    {variant === "admin" && (
                      <td className="px-4 py-3">
                        {r.errorPhase ? (
                          <Badge variant="neutral" className="rounded-full">
                            {t(`errors.phases.${r.errorPhase}` as const)}
                          </Badge>
                        ) : (
                          <span className="text-neutral-400 dark:text-neutral-600">-</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <Badge variant="neutral" className="rounded-full">
                        {t(`errors.categories.${category}` as const)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge variant={statusVariant(r.httpStatus)} className="rounded-full font-mono">
                        {r.httpStatus ?? "-"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-neutral-500 dark:text-neutral-400">
                      {r.latencyMs != null ? `${r.latencyMs}ms` : "-"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(r.id);
                        }}
                        className="text-xs text-sora-blue hover:underline"
                      >
                        {t("errors.viewDetail")}
                      </button>
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

      <ErrorDetailDrawer row={selected} open={!!selected} onClose={() => setSelectedId(null)} variant={variant} />
    </div>
  );
}

export default ErrorLogsTable;
