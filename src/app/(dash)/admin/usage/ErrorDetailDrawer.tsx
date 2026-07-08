"use client";
/**
 * 错误请求详情抽屉(Client Component)—— 复用 shared/ui/Modal。
 *
 * variant:
 *   - admin:展示全部字段(errorCode/errorMessage/requestPath/provider/route/upstream/...)
 *   - panel:脱敏视图,只露白名单字段(时间/模型/分类/HTTP/耗时),不含 errorMessage
 *     全文、provider、route、requestPath、上游 endpoint 等敏感信息。
 *
 * 分类(category)由 error-classify 在前端按需派生,对应 admin.usage.errors.categories.*。
 */
import Modal from "@/shared/ui/Modal";
import Badge from "@/shared/ui/Badge";
import { useTranslations } from "next-intl";
import { type ErrorCategory } from "@/lib/error-classify";
import type { ErrorLogClientRow } from "./ErrorLogsTable";

interface ErrorDetailDrawerProps {
  row: ErrorLogClientRow | null;
  open: boolean;
  onClose: () => void;
  variant: "admin" | "panel";
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 分类对应的 badge 颜色(低饱和)。 */
function categoryVariant(c: ErrorCategory): "primary" | "warning" | "danger" | "success" | "neutral" {
  switch (c) {
    case "auth":
    case "invalid_request":
      return "neutral";
    case "rate_limit":
    case "quota":
      return "warning";
    case "service_unavailable":
    case "upstream":
      return "danger";
    case "internal":
      return "danger";
    default:
      return "neutral";
  }
}

export function ErrorDetailDrawer({ row, open, onClose, variant }: ErrorDetailDrawerProps) {
  const t = useTranslations("admin.usage");
  if (!row) return null;

  const category = row.category;
  const phaseLabel = row.errorPhase ? t(`errors.phases.${row.errorPhase}` as const) : "-";

  // 通用字段行(admin / panel 共享)。
  const commonRows: { label: string; value: string }[] = [
    { label: t("errors.detailCreatedAt"), value: formatDateTime(row.createdAt) },
    { label: t("errors.detailModel"), value: row.model },
    { label: t("errors.detailCategory"), value: t(`errors.categories.${category}` as const) },
    { label: t("errors.detailHttpStatus"), value: row.httpStatus != null ? String(row.httpStatus) : "-" },
    { label: t("errors.detailLatency"), value: row.latencyMs != null ? `${row.latencyMs}ms` : "-" },
  ];

  // admin 专属(含敏感信息:errorMessage/provider/route/requestPath/上游/tokens/TTFT)。
  const adminRows: { label: string; value: string }[] = [
    { label: t("errors.detailErrorCode"), value: row.errorCode },
    { label: t("errors.detailPhase"), value: phaseLabel },
    { label: t("errors.detailSource"), value: t(`sources.${row.source}` as const) },
    { label: t("errors.detailUpstreamModel"), value: row.upstreamModel ?? "-" },
    { label: t("errors.detailProvider"), value: row.providerName ?? row.providerRef ?? "-" },
    { label: t("errors.detailRoute"), value: row.routeName ?? "-" },
    { label: t("errors.detailRequestPath"), value: row.requestPath ?? "-" },
    { label: t("errors.detailTtft"), value: row.firstTokenLatencyMs != null ? `${row.firstTokenLatencyMs}ms` : "-" },
    { label: t("errors.detailPromptTokens"), value: String(row.promptTokens) },
    { label: t("errors.detailCompletionTokens"), value: String(row.completionTokens) },
  ];

  const rows = variant === "panel" ? commonRows : [...commonRows, ...adminRows];

  return (
    <Modal open={open} onClose={onClose} title={t("errors.detailTitle")} dialogClassName="m-auto w-[min(640px,92vw)] rounded-lg border border-morning-mist bg-nebula-white p-0 text-space-ink shadow-xl backdrop:bg-black/40 dark:border-deep-space dark:bg-twilight-obsidian dark:text-nebula-silver">
      <div className="space-y-4">
        {/* 分类徽标 */}
        <div className="flex items-center gap-2">
          <Badge variant={categoryVariant(category)} className="rounded-full">
            {t(`errors.categories.${category}` as const)}
          </Badge>
          {row.errorPhase && (
            <Badge variant="neutral" className="rounded-full">
              {phaseLabel}
            </Badge>
          )}
        </div>

        <dl className="grid grid-cols-3 gap-x-4 gap-y-3 text-xs">
          {rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-neutral-400 dark:text-neutral-500 uppercase tracking-wider font-semibold text-[10px] self-center">
                {r.label}
              </dt>
              <dd className="col-span-2 font-mono text-neutral-800 dark:text-neutral-200 break-all">{r.value}</dd>
            </div>
          ))}
        </dl>

        {/* errorMessage 仅 admin 展示,且为长文块 */}
        {variant === "admin" && row.errorMessage && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold">
              {t("errors.detailErrorMessage")}
            </div>
            <pre className="whitespace-pre-wrap break-all rounded-md border border-morning-mist dark:border-deep-space bg-neutral-50/60 dark:bg-neutral-900/30 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 font-mono">
              {row.errorMessage}
            </pre>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default ErrorDetailDrawer;
