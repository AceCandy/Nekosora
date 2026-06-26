"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { HeartPulse } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import Badge from "@/shared/ui/Badge";

/** server action 签名:检测 provider 所有 key,返回健康汇总。 */
export type HealthAction = (providerId: string) => Promise<{
  healthy: number;
  total: number;
  checkedAt: number;
}>;

interface ProviderHealthButtonProps {
  /** 已 bind 好 id 的健康检测 action。 */
  action: HealthAction;
  providerId: string;
  /** 落库的初始健康度(列表回显)。 */
  initial?: {
    healthy: number | null;
    total: number | null;
    checkedAt: Date | null;
  };
}

type Display = { healthy: number; total: number; checkedAt: number } | null;

/**
 * Provider 全量密钥健康检测按钮 —— 检测该 provider 所有 key,
 * 汇总成 X/Y 健康徽章(如 2/3),结果落库,刷新后仍可见。
 *
 * 与编辑弹窗里的逐 key 即时测试互补:
 *   弹窗内测未保存的 key(配 key 时验证);
 *   此处测已存库的全量 key(列表级健康概览 + 持久化)。
 */
export default function ProviderHealthButton({
  action,
  providerId,
  initial,
}: ProviderHealthButtonProps) {
  const t = useTranslations("providers");
  const [isPending, startTransition] = useTransition();
  // 当前展示的健康度:优先用即时检测结果,回退到落库值。
  const [display, setDisplay] = useState<Display>(
    initial?.checkedAt
      ? {
          healthy: initial.healthy ?? 0,
          total: initial.total ?? 0,
          checkedAt: initial.checkedAt instanceof Date ? initial.checkedAt.getTime() : Number(initial.checkedAt),
        }
      : null,
  );

  const handleCheck = () => {
    startTransition(async () => {
      const result = await action(providerId);
      setDisplay(result);
    });
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        variant="ghost"
        size="sm"
        loading={isPending}
        onClick={handleCheck}
        className="text-neutral-750 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
        title={t("healthCheckTitle")}
      >
        <HeartPulse className="w-3.5 h-3.5" />
        <span>{t("healthCheck")}</span>
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
