"use client";
import { useTranslations } from "next-intl";
import { HeartPulse, Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import Badge from "@/shared/ui/Badge";
import Popover from "@/shared/ui/Popover";
import { clsx } from "clsx";
import type { ProviderKeyResult } from "@/db/schema/pg";

/** server action 签名:检测 provider 所有 key,返回存活汇总(网络层 + key 层 + per-key)。 */
export type HealthAction = (providerId: string) => Promise<{
  healthy: number;
  total: number;
  checkedAt: number;
  networkOk: boolean;
  keyResults: ProviderKeyResult[];
}>;

/** 存活检测展示状态:null 表示无可用结果。 */
export type HealthDisplay = {
  healthy: number;
  total: number;
  checkedAt: number;
  networkOk: boolean;
  keyResults: ProviderKeyResult[];
} | null;

interface ProviderHealthButtonProps {
  /** 当前展示的存活状态(由父组件控制,支持"全部检测"统一刷新)。 */
  display: HealthDisplay;
  /** 检测进行中(按钮禁用 + 图标转圈)。 */
  pending: boolean;
  /** 触发检测。 */
  onCheck: () => void;
  /** 仅图标模式:隐藏"存活检测"文字,用于紧凑列表内联。 */
  iconOnly?: boolean;
}

/**
 * Provider 全量密钥存活检测按钮(受控)。检测该 provider 所有 key,
 * 汇总成 X/Y 徽章(如 2/3)+ 网络层标记 + per-key 悬浮详情。状态与触发逻辑
 * 上提到父组件,以便表头"全部检测"能统一刷新所有行。
 *
 * 与编辑弹窗里的逐 key 即时测试互补:
 *   弹窗内测未保存的 key(配 key 时验证);
 *   此处测已存库的全量 key(列表级存活概览 + 持久化)。
 */
export default function ProviderHealthButton({
  display,
  pending,
  onCheck,
  iconOnly,
}: ProviderHealthButtonProps) {
  const t = useTranslations("providers");
  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        variant="ghost"
        size={iconOnly ? "xs" : "sm"}
        disabled={pending}
        onClick={onCheck}
        className="text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
        title={t("healthCheckTitle")}
      >
        {pending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <HeartPulse className="w-3.5 h-3.5" />
        )}
        {!iconOnly && <span>{t("healthCheck")}</span>}
      </Button>
      {display && (
        <>
          {display.networkOk === false && (
            <span
              className="text-[11px] font-medium text-red-500 dark:text-red-400"
              title={t("networkDown")}
            >
              {t("networkDown")}
            </span>
          )}
          <HealthBadge
            healthy={display.healthy}
            total={display.total}
            keyResults={display.keyResults}
          />
        </>
      )}
    </span>
  );
}

/** X/Y 存活徽章:全部有效 success,部分无效 warning,全挂 danger。hover 出 per-key 详情。 */
function HealthBadge({
  healthy,
  total,
  keyResults,
}: {
  healthy: number;
  total: number;
  keyResults?: ProviderKeyResult[];
}) {
  const t = useTranslations("providers");
  const variant = total === 0
    ? "neutral"
    : healthy === total
      ? "success"
      : healthy === 0
        ? "danger"
        : "warning";
  const badge = (
    <Badge variant={variant as "neutral" | "success" | "warning" | "danger"}>
      {healthy}/{total}
      {healthy > 0 && healthy < total && (
        <span className="ml-1 opacity-70">{t("healthPartial")}</span>
      )}
    </Badge>
  );
  // 无 per-key 结果(未检测或旧数据)时只显徽章,不挂悬浮。
  if (!keyResults || keyResults.length === 0) return badge;
  return (
    <Popover
      openOnHover
      hoverDelayMs={300}
      clickToggle
      side="bottom"
      align="left"
      panelClassName="p-0"
      trigger={badge}
    >
      <div className="max-h-60 w-56 overflow-auto py-1">
        {keyResults.map((r) => (
          <div
            key={r.index}
            className="px-2 py-1 text-xs flex items-center justify-between gap-2"
          >
            <span className="text-neutral-500 dark:text-neutral-400 font-mono">
              {t("keyResultTitle", { index: r.index })}
            </span>
            <span
              className={clsx(
                "font-medium",
                r.ok
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-500 dark:text-red-400",
              )}
              title={r.error}
            >
              {r.ok
                ? t("keyValid")
                : r.errorKind === "network"
                  ? t("keyNetworkError")
                  : r.errorKind === "auth"
                    ? t("keyInvalid")
                    : t("keyUnknownError")}
            </span>
          </div>
        ))}
      </div>
    </Popover>
  );
}
