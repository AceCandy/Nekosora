"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import type { FetchModelsAction } from "@/features/models/UpstreamModelPicker";

/** 单条路由的同步状态。 */
export type SyncStatus = "synced" | "local-only" | "unknown";

interface ModelSyncCheckerProps {
  /** 需要校验的路由:每条带 providerId + upstreamModelName。 */
  routes: { id: string; providerId: string; upstreamModelName: string }[];
  /** 拉取上游模型列表的 action(按 providerId)。 */
  fetchAction: FetchModelsAction;
  /** 校验完成后,把 routeId → 状态映射回传给父组件渲染。 */
  onResult: (map: Record<string, SyncStatus>) => void;
}

/**
 * 模型同步检查 —— 按路由所属 provider 去重拉取上游 /models,
 * 比对每条路由的 upstreamModelName 是否仍在上游存在。
 *
 * - synced: 上游存在该模型(健康)
 * - local-only: 上游不存在(高危:配错或已被下线)
 * - unknown: 拉取失败/未拉到(无法判断,不阻塞)
 *
 * 同一 provider 只拉取一次,避免重复请求。
 */
export default function ModelSyncChecker({
  routes,
  fetchAction,
  onResult,
}: ModelSyncCheckerProps) {
  const t = useTranslations("models");
  const [isPending, startTransition] = useTransition();
  const [checked, setChecked] = useState(false);

  const handleCheck = () => {
    startTransition(async () => {
      // 按 provider 去重,避免同一 provider 多条路由重复拉取。
      const providerIds = [...new Set(routes.map((r) => r.providerId))];
      const remoteByProvider = new Map<string, Set<string>>();
      await Promise.all(
        providerIds.map(async (pid) => {
          try {
            const list = await fetchAction(pid);
            remoteByProvider.set(
              pid,
              new Set(list.map((m) => m.id)),
            );
          } catch {
            // 该 provider 拉取失败:标记为 unknown(集合缺失即判 unknown)。
          }
        }),
      );

      const map: Record<string, SyncStatus> = {};
      for (const r of routes) {
        const remote = remoteByProvider.get(r.providerId);
        if (!remote) {
          map[r.id] = "unknown";
        } else {
          map[r.id] = remote.has(r.upstreamModelName) ? "synced" : "local-only";
        }
      }
      onResult(map);
      setChecked(true);
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      loading={isPending}
      onClick={handleCheck}
      className="text-sora-blue hover:text-sora-blue-hover"
      title={t("syncCheckTitle")}
    >
      <RefreshCw className="w-3 h-3" />
      <span>{checked ? t("syncRecheck") : t("syncCheck")}</span>
    </Button>
  );
}
