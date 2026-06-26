"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Zap } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import Badge from "@/shared/ui/Badge";
import type { ProbeResult } from "@/lib/providers/probe";

/** server action 签名:接收路由/模型 id,返回探测结果。 */
export type RouteTestAction = (id: string) => Promise<ProbeResult>;

interface RouteTestButtonProps {
  /** 已 bind 好 id 的测试 action。 */
  action: RouteTestAction;
  /** 路由 id(全局)或模型 id(byo)。 */
  id: string;
}

type State = { kind: "idle" } | { kind: "result"; result: ProbeResult };

/**
 * 模型可用性测试按钮 —— 用该路由/模型的 provider+key+upstreamModelName
 * 发一次极小请求,确认"这个 provider 真能跑这个模型",而不仅是 key 有效。
 * 结果徽章贴在按钮旁,三态:可用(延迟)/ 认证失败 / 网络异常。
 */
export default function RouteTestButton({ action, id }: RouteTestButtonProps) {
  const t = useTranslations("models");
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<State>({ kind: "idle" });

  const handleTest = () => {
    startTransition(async () => {
      try {
        const result = await action(id);
        setState({ kind: "result", result });
      } catch (e) {
        setState({
          kind: "result",
          result: {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            errorKind: "unknown",
          },
        });
      }
    });
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        variant="ghost"
        size="xs"
        loading={isPending}
        onClick={handleTest}
        className="text-sora-blue hover:text-sora-blue-hover"
        title={t("testModelTitle")}
      >
        <Zap className="w-3 h-3" />
        <span>{t("testModel")}</span>
      </Button>
      {state.kind === "result" && <ResultBadge result={state.result} />}
    </span>
  );
}

function ResultBadge({ result }: { result: ProbeResult }) {
  const t = useTranslations("models");
  if (result.ok) {
    return (
      <Badge variant="success" title={result.error}>
        {t("keyValid")}{result.latencyMs != null ? ` ${result.latencyMs}ms` : ""}
      </Badge>
    );
  }
  if (result.errorKind === "auth") {
    return (
      <Badge variant="danger" title={result.error}>
        {t("keyInvalid")}
      </Badge>
    );
  }
  if (result.errorKind === "network") {
    return (
      <Badge variant="warning" title={result.error}>
        {t("keyNetworkError")}
      </Badge>
    );
  }
  return (
    <Badge variant="warning" title={result.error}>
      {t("keyUnknownError")}
    </Badge>
  );
}
