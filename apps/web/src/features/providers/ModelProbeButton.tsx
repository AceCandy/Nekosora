"use client";
import { useTranslations } from "next-intl";
import { Zap, Check, X, Loader2 } from "lucide-react";
import type { ProbeResult } from "@/lib/providers/probe";

/** server action 签名:用 provider 的 testModel 发极小生成,验证 model+key+协议全链路。 */
export type ModelProbeAction = (providerId: string) => Promise<ProbeResult>;

/** 深度检测展示状态:null 表示未检测。 */
export type ModelProbeDisplay = {
  ok: boolean;
  checkedAt: number;
  error?: string;
  errorKind?: "auth" | "network" | "unknown";
} | null;

interface ModelProbeButtonProps {
  /** 当前展示的深度检测状态(父组件控制,落库回显 + 会话覆盖)。 */
  display: ModelProbeDisplay;
  /** 检测进行中。 */
  pending: boolean;
  /** 触发检测/重测。 */
  onProbe: () => void;
  /** 是否配置了 testModel;未配置则禁用并提示。 */
  hasTestModel: boolean;
}

/**
 * testModel 深度检测按钮(受控):用 testModel 发极小生成请求,验证 model+key+协议全链路。
 *
 * 状态:未配 testModel(禁用)/ 未测(Zap)/ 测中(转圈)/ 通过(绿对号,hover 重测)/ 失败(红 X,hover 错误+重测)。
 * 与存活检测(ProviderHealthButton)互补:存活检测空 body 验 key,深度检测带 model 验全链路;
 * opencode 等先校验 model 的上游,空 body 验不了 key,只能靠深度检测确认可用性。
 */
export default function ModelProbeButton({
  display,
  pending,
  onProbe,
  hasTestModel,
}: ModelProbeButtonProps) {
  const t = useTranslations("providers");

  if (!hasTestModel) {
    return (
      <button
        type="button"
        disabled
        title={t("deepProbeNoTestModel")}
        className="inline-flex items-center justify-center rounded p-1 text-neutral-300  cursor-not-allowed"
      >
        <Zap className="w-3.5 h-3.5" />
      </button>
    );
  }

  const icon = pending ? (
    <Loader2 className="w-3.5 h-3.5 animate-spin" />
  ) : display?.ok ? (
    <Check className="w-3.5 h-3.5" />
  ) : display && !display.ok ? (
    <X className="w-3.5 h-3.5" />
  ) : (
    <Zap className="w-3.5 h-3.5" />
  );

  const color = display?.ok
    ? "text-success hover:text-success  "
    : display && !display.ok
      ? "text-danger hover:text-danger-hover  "
      : "text-neutral-400 hover:text-neutral-700  ";

  // 通过 -> hover 提示重测;失败 -> hover 显示错误 + 重测;未测 -> 提示检测。
  const title = display
    ? display.ok
      ? t("deepProbeRetest")
      : display.error
        ? `${display.error} — ${t("deepProbeRetest")}`
        : t("deepProbeFailed")
    : t("deepProbeTitle");

  return (
    <button
      type="button"
      onClick={onProbe}
      disabled={pending}
      title={title}
      className={`inline-flex items-center justify-center rounded p-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${color}`}
    >
      {icon}
    </button>
  );
}
