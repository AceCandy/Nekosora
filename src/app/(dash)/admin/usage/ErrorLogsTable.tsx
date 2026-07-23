"use client";
/**
 * 错误请求表(Client Component)—— ops_error_logs 列表。
 *
 * admin / panel 共用,variant 区分:
 *   - admin:含用户列 + 用户筛选(可跨用户)。
 *   - panel:锁定当前用户(无用户列/用户筛选),其余列与 admin 一致(自己调用可见全字段)。
 * 列布局:时间 / 用户(admin) / 来源 / 执行链路(服务商·模型↳上游·上游key) /
 * key(对外密钥) / 阶段 / 分类 / HTTP / 耗时(整行点击进详情)。
 * 筛选栏 ErrorFilterBar(两排 typeahead + 级联)。点击行打开 ErrorDetailDrawer。
 *
 * 错误分类(category)由服务端预先派生(error-classify)后随行下发,客户端直接用 i18n 渲染。
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import Badge from "@/shared/ui/Badge";
import { Pagination } from "@/shared/ui/Pagination";
import { formatDateTimeLocal, formatDuration } from "@/shared/lib/format";
import { type ErrorCategory } from "@/lib/error-classify";
import { ErrorFilterBar, type ErrorFilterValues } from "./ErrorFilterBar";
import { ErrorDetailDrawer } from "./ErrorDetailDrawer";

/**
 * 客户端行类型(createdAt 已序列化为 ISO 字符串)。
 * category 由服务端预先派生(error-classify)。panel 视图与 admin 同款字段
 * (均为用户自己调用产生,可见);不再做字段级脱敏。
 */
export interface ErrorLogClientRow {
  id: string;
  /** 一次生成的关联 id(同一次请求的多次 key 尝试共享;用于聚合重试链)。 */
  requestId: string;
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
  /** 命中的对外网关 key 名(LEFT JOIN apiKeys.name)。 */
  apiKeyName: string | null;
  /** 命中上游 key 的脱敏快照(前3后3,中间 *)。 */
  upstreamKeyMasked: string | null;
  /** 用户名(LEFT JOIN user.name;仅 admin 列展示)。 */
  userName: string | null;
  /** 用户邮箱(LEFT JOIN user.email;仅 admin 列展示)。 */
  userEmail: string | null;
  /** 副任务类型(null=主回复/网关请求;title/memory/compact=后台副任务)。 */
  taskKind: string | null;
  /** 尝试序号(1..N);null=非尝试记录(中断)。同 requestId 按 attempt 升序即完整重试链。 */
  attempt: number | null;
  /** 粗分类(服务端派生,前端 i18n key 后缀)。 */
  category: ErrorCategory;
  createdAt: string;
}

interface ErrorLogsTableProps {
  rows: ErrorLogClientRow[];
  total: number;
  page: number;
  pageSize: number;
  filterValues: ErrorFilterValues;
  /** 已选 user/key 的 displayLabel(SSR 查;provider/model/upstreamKey 的 label=value 本身)。 */
  labels: { user?: string; key?: string };
  basePath: string;
  variant: "admin" | "panel";
  /**
   * 当前页涉及 requestId 的全部尝试(方案 X:每次 key 失败各记一条)。
   * key=requestId,value=按 attempt 升序的尝试链(含当前页可见行 + 跨页的其他尝试)。
   * 供详情 drawer 展示完整重试链。缺省时 drawer 不展示重试链。
   */
  attemptsByRequestId?: Record<string, ErrorLogClientRow[]>;
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
  labels,
  basePath,
  variant,
  attemptsByRequestId,
}: ErrorLogsTableProps) {
  const t = useTranslations("admin.usage");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  // 选中行的完整重试链(同 requestId 全部尝试,按 attempt 升序);无预查数据时退化为仅当前行。
  const selectedAttempts =
    selected
      ? (attemptsByRequestId?.[selected.requestId] ?? [selected])
      : null;

  const buildPageHref = (p: number) => {
    const params = new URLSearchParams();
    params.set("tab", "errors");
    const v = filterValues;
    if (v.range) params.set("range", v.range);
    if (v.start) params.set("start", v.start);
    if (v.end) params.set("end", v.end);
    if (v.user) params.set("user", v.user);
    if (v.source) params.set("source", v.source);
    if (v.key) params.set("key", v.key);
    if (v.phase) params.set("phase", v.phase);
    if (v.provider) params.set("provider", v.provider);
    if (v.model) params.set("model", v.model);
    if (v.upstreamKey) params.set("upstreamKey", v.upstreamKey);
    if (v.httpStatus) params.set("httpStatus", v.httpStatus);
    if (v.showAuth) params.set("showAuth", v.showAuth);
    params.set("page", String(p));
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="space-y-3">
      <ErrorFilterBar variant={variant} values={filterValues} labels={labels} basePath={basePath} />

      <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] overflow-hidden shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-ui-caption border-collapse">
            <thead>
              <tr className="bg-neutral-50/70 border-b border-neutral-200 text-neutral-500 dark:bg-neutral-900/50 dark:border-neutral-800 dark:text-neutral-400 uppercase tracking-wider font-semibold">
                <th className="text-left px-4 py-3">{t("thCreatedAt")}</th>
                {variant === "admin" && <th className="text-left px-4 py-3">{t("thUser")}</th>}
                <th className="text-left px-4 py-3">{t("thSource")}</th>
                <th className="text-left px-4 py-3">{t("thChain")}</th>
                <th className="text-left px-4 py-3">{t("thKey")}</th>
                <th className="text-left px-4 py-3">{t("errors.detailPhase")}</th>
                <th className="text-left px-4 py-3">{t("errors.detailCategory")}</th>
                <th className="text-right px-4 py-3">{t("errors.detailHttpStatus")}</th>
                <th className="text-right px-4 py-3">{t("thLatency")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={variant === "admin" ? 9 : 8} className="px-4 py-10 text-center text-neutral-400 dark:text-neutral-500">
                    {t("errors.empty")}
                  </td>
                </tr>
              )}
              {rows.map((r, idx) => {
                const category = r.category;
                // 同 requestId 相邻的非首行 = 同一请求的重试尝试,浅色底标识。
                const isRetry = idx > 0 && rows[idx - 1].requestId === r.requestId;
                return (
                  <tr
                    key={r.id}
                    className={clsx(
                      "hover:bg-neutral-50/30 dark:hover:bg-neutral-900/10 transition-colors duration-150 cursor-pointer",
                      isRetry && "bg-neutral-50/40 dark:bg-neutral-900/15",
                    )}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <td className="px-4 py-3 font-mono text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                      {formatDateTimeLocal(r.createdAt)}
                    </td>
                    {variant === "admin" && (
                      <td className="px-4 py-3 max-w-[160px]">
                        <div className="font-medium text-neutral-700 dark:text-neutral-300 truncate">{r.userName ?? "-"}</div>
                        {r.userEmail && (
                          <div className="font-mono text-ui-caption text-neutral-400 dark:text-neutral-500 truncate">{r.userEmail}</div>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 font-mono text-neutral-700 dark:text-neutral-300">
                      <span className="inline-flex items-center gap-1.5">
                        {t(`sources.${r.source}` as const)}
                        {r.taskKind && (
                          <Badge variant="neutral" className="rounded-full font-sans text-ui-caption font-normal">
                            {t(`taskKinds.${r.taskKind}` as const)}
                          </Badge>
                        )}
                      </span>
                    </td>
                    {/* 执行链路:服务商 · 模型(↳上游) · 脱敏上游key;attempt 序号 + ↳ 重试标识 */}
                    <td className="px-4 py-3 max-w-[240px]">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          {r.attempt != null && (
                            <span className="shrink-0 inline-flex items-center rounded-full bg-sora-blue/10 px-1.5 py-0.5 text-ui-caption font-mono font-semibold text-sora-blue">
                              #{r.attempt}
                            </span>
                          )}
                          {isRetry && (
                            <span className="shrink-0 text-neutral-400 dark:text-neutral-500 text-ui-caption">↳</span>
                          )}
                          <span className="truncate text-neutral-700 dark:text-neutral-300">{r.providerName ?? r.providerRef ?? "-"}</span>
                        </div>
                        <div className="font-mono text-neutral-900 dark:text-white truncate">
                          {r.model}
                          {r.upstreamModel && r.upstreamModel !== r.model && (
                            <span className="block text-ui-caption text-neutral-400 dark:text-neutral-500 truncate">↳ {r.upstreamModel}</span>
                          )}
                        </div>
                        {r.upstreamKeyMasked && (
                          <div className="font-mono text-ui-caption text-neutral-400 dark:text-neutral-500 truncate">{r.upstreamKeyMasked}</div>
                        )}
                      </div>
                    </td>
                    {/* Key:对外密钥(apiKeyName) */}
                    <td className="px-4 py-3 font-mono text-neutral-700 dark:text-neutral-300 truncate max-w-[160px]">
                      {r.apiKeyName ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      {r.errorPhase ? (
                        <Badge variant="neutral" className="rounded-full">
                          {t(`errors.phases.${r.errorPhase}` as const)}
                        </Badge>
                      ) : (
                        <span className="text-neutral-400 dark:text-neutral-600">-</span>
                      )}
                    </td>
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
                      {formatDuration(r.latencyMs)}
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

      <ErrorDetailDrawer
        row={selected}
        attempts={selectedAttempts}
        open={!!selected}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

export default ErrorLogsTable;
