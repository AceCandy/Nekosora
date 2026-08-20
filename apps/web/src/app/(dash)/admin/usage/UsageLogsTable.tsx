"use client";
/**
 * 用量明细表(Client Component)—— 成功计费调用明细。
 *
 * admin / panel 共用,variant 区分(admin 含用户列)。
 * 列布局:时间 / 用户(admin) / 来源 / 执行链路(服务商·模型↳上游·上游key) /
 * Key(对外密钥) / Token(↓↑·缓存 + hover 明细) / 耗时(总·TTFT)。
 * 筛选栏为 UsageFilterBar(两排 + Combobox typeahead + 级联即时刷新)。
 */
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { Pagination } from "@/shared/ui/Pagination";
import { Popover } from "@/shared/ui/Popover";
import Badge from "@/shared/ui/Badge";
import { formatDateTimeLocal, formatDuration } from "@/shared/lib/format";
import { UsageFilterBar, type UsageFilterValues } from "./UsageFilterBar";
import { getTaskKindMessageKey } from "./task-kind";

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
  /** 命中的对外网关 key 名(panel 可见;错误视图脱敏置空)。 */
  apiKeyName: string | null;
  /** 命中上游 key 的脱敏快照(执行链路列展示;panel 不下发)。 */
  upstreamKeyMasked: string | null;
  /** 用户名(LEFT JOIN user.name;仅 admin 列展示)。 */
  userName: string | null;
  /** 用户邮箱(LEFT JOIN user.email;仅 admin 列展示)。 */
  userEmail: string | null;
  /** 副任务类型(null=主回复/网关请求;title/memory/compact/web_search=后台副任务)。 */
  taskKind: string | null;
  createdAt: string;
}

interface UsageLogsTableProps {
  rows: UsageLogClientRow[];
  total: number;
  page: number;
  pageSize: number;
  filterValues: UsageFilterValues;
  /** 已选 user/key 的 displayLabel(SSR 查;provider/model/upstreamKey 的 label=value 本身)。 */
  labels: { user?: string; key?: string };
  basePath: string;
  tab: "usage" | "errors";
  variant?: "admin" | "panel";
}

export function UsageLogsTable({
  rows,
  total,
  page,
  pageSize,
  filterValues,
  labels,
  basePath,
  tab,
  variant = "admin",
}: UsageLogsTableProps) {
  const t = useTranslations("admin.usage");

  const buildPageHref = (p: number) => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    const v = filterValues;
    if (v.range) params.set("range", v.range);
    if (v.start) params.set("start", v.start);
    if (v.end) params.set("end", v.end);
    if (v.user) params.set("user", v.user);
    if (v.source) params.set("source", v.source);
    if (v.key) params.set("key", v.key);
    if (v.provider) params.set("provider", v.provider);
    if (v.model) params.set("model", v.model);
    if (v.upstreamKey) params.set("upstreamKey", v.upstreamKey);
    params.set("page", String(p));
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="space-y-3">
      <UsageFilterBar variant={variant} values={filterValues} labels={labels} basePath={basePath} tab={tab} />

      <div className="rounded-lg border border-neutral-200 bg-white   overflow-hidden shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-ui-caption border-collapse">
            <thead>
              <tr className="bg-neutral-50/70 border-b border-neutral-200 text-neutral-500    uppercase tracking-wider font-semibold">
                <th className="text-left px-4 py-3">{t("thCreatedAt")}</th>
                {variant === "admin" && <th className="text-left px-4 py-3">{t("thUser")}</th>}
                <th className="text-left px-4 py-3">{t("thSource")}</th>
                <th className="text-left px-4 py-3">{t("thChain")}</th>
                <th className="text-left px-4 py-3">{t("thKey")}</th>
                <th className="text-right px-4 py-3">{t("thTokens")}</th>
                <th className="text-right px-4 py-3">{t("thDuration")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 ">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={variant === "admin" ? 7 : 6} className="px-4 py-10 text-center text-ink-tertiary ">
                    {t("emptyLogs")}
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const totalTokens = r.promptTokens + r.completionTokens + r.cacheReadTokens;
                const taskKindMessageKey = r.taskKind ? getTaskKindMessageKey(r.taskKind) : null;
                return (
                  <tr key={r.id} className="hover:bg-neutral-50/30  transition-colors duration-150">
                    <td className="px-4 py-3 font-mono text-neutral-500  whitespace-nowrap">
                      {formatDateTimeLocal(r.createdAt)}
                    </td>
                    {variant === "admin" && (
                      <td className="px-4 py-3 max-w-[160px]">
                        <div className="font-medium text-neutral-700  truncate">{r.userName ?? "-"}</div>
                        {r.userEmail && (
                          <div className="font-mono text-ui-caption text-ink-tertiary  truncate">{r.userEmail}</div>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 font-mono text-neutral-700 ">
                      <span className="inline-flex items-center gap-1.5">
                        {t(`sources.${r.source}` as const)}
                        {r.taskKind && (
                          <Badge variant="neutral" className="rounded-full font-sans text-ui-caption font-normal">
                            {taskKindMessageKey ? t(taskKindMessageKey) : r.taskKind}
                          </Badge>
                        )}
                      </span>
                    </td>
                    {/* 执行链路列:服务商 · 请求模型(↳上游模型) · 脱敏上游key */}
                    <td className="px-4 py-3 max-w-[240px]">
                      <div className="space-y-0.5">
                        <div className="text-neutral-700  truncate">{r.providerName ?? r.providerRef ?? "-"}</div>
                        <div className="font-mono text-neutral-900  truncate">
                          {r.model}
                          {r.upstreamModel && r.upstreamModel !== r.model && (
                            <span className="block text-ui-caption text-ink-tertiary  truncate">↳ {r.upstreamModel}</span>
                          )}
                        </div>
                        {r.upstreamKeyMasked && (
                          <div className="font-mono text-ui-caption text-ink-tertiary  truncate">{r.upstreamKeyMasked}</div>
                        )}
                      </div>
                    </td>
                    {/* Key:对外密钥(apiKeyName);上游key 已移到执行链路列 */}
                    <td className="px-4 py-3 font-mono text-neutral-700  truncate max-w-[160px]">
                      {r.apiKeyName ?? "-"}
                    </td>
                    {/* Token 合并列:输入↓ 输出↑ / 缓存读取 + hover 明细 */}
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <div className="space-y-0.5 font-mono">
                          <div className="text-neutral-800 ">
                            {r.promptTokens.toLocaleString()}
                            <span className="text-ink-tertiary mx-0.5">↓</span>
                            {r.completionTokens.toLocaleString()}
                            <span className="text-ink-tertiary mx-0.5">↑</span>
                          </div>
                          {r.cacheReadTokens > 0 && (
                            <div className="text-ui-caption text-ink-tertiary ">
                              {t("thCacheRead")}: {r.cacheReadTokens.toLocaleString()}
                            </div>
                          )}
                        </div>
                        <Popover
                          open={false}
                          onClose={() => {}}
                          openOnHover
                          side="top"
                          align="right"
                          panelClassName="w-44 p-2.5"
                          trigger={<Info className="size-3.5 text-ink-tertiary hover:text-neutral-600  cursor-help" />}
                        >
                          <div className="space-y-1 text-ui-caption font-mono">
                            <div className="flex justify-between gap-3">
                              <span className="text-neutral-500">{t("thInput")}</span>
                              <span className="text-neutral-800 ">{r.promptTokens.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-neutral-500">{t("thOutput")}</span>
                              <span className="text-neutral-800 ">{r.completionTokens.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-neutral-500">{t("thCacheRead")}</span>
                              <span className="text-neutral-500">{r.cacheReadTokens.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between gap-3 border-t border-neutral-100  pt-1">
                              <span className="text-neutral-500">{t("tokenTotal")}</span>
                              <span className="text-neutral-900  font-semibold">{totalTokens.toLocaleString()}</span>
                            </div>
                          </div>
                        </Popover>
                      </div>
                    </td>
                    {/* 耗时合并列:总耗时 / TTFT */}
                    <td className="px-4 py-3 text-right font-mono">
                      <div className="text-neutral-800 ">{formatDuration(r.latencyMs)}</div>
                      <div className="text-ui-caption text-ink-tertiary ">{formatDuration(r.firstTokenLatencyMs)}</div>
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
