"use client";
import { useTranslations } from "next-intl";
import { HeartPulse, Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import Badge from "@/shared/ui/Badge";

/** server action 签名:检测 provider 所有 key,返回健康汇总。 */
export type HealthAction = (providerId: string) => Promise<{
  healthy: number;
  total: number;
  checkedAt: number;
}>;

/** 健康度展示状态:null 表示无可用结果。 */
export type HealthDisplay = { healthy: number; total: number; checkedAt: number } | null;

interface ProviderHealthButtonProps {
  /** 当前展示的健康度(由父组件控制,支持"全部检测"统一刷新)。 */
  display: HealthDisplay;
  /** 检测进行中(按钮禁用 + 图标转圈)。 */
  pending: boolean;
  /** 触发检测。 */
  onCheck: () => void;
  /** 仅图标模式:隐藏"检测"文字,用于紧凑列表内联。 */
  iconOnly?: boolean;
}

/**
 * Provider 全量密钥健康检测按钮(受控)。检测该 provider 所有 key,
 * 汇总成 X/Y 健康徽章(如 2/3)。状态与触发逻辑上提到父组件,
 * 以便表头"全部检测"能统一刷新所有行。
 *
 * 与编辑弹窗里的逐 key 即时测试互补:
 *   弹窗内测未保存的 key(配 key 时验证);
 *   此处测已存库的全量 key(列表级健康概览 + 持久化)。
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
      {display && <HealthBadge healthy={display.healthy} total={display.total} />}
    </span>
  );
}

/** X/Y 健康徽章:全部健康用 success,部分失败用 warning,全挂用 danger。 */
function HealthBadge({ healthy, total }: { healthy: number; total: number }) {
  const t = useTranslations("providers");
  const variant = total === 0
    ? "neutral"
    : healthy === total
      ? "success"
      : healthy === 0
        ? "danger"
        : "warning";
  return (
    <Badge variant={variant as "neutral" | "success" | "warning" | "danger"}>
      {healthy}/{total}
      {healthy > 0 && healthy < total && (
        <span className="ml-1 opacity-70">{t("healthPartial")}</span>
      )}
    </Badge>
  );
}
