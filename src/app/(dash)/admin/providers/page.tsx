import {
  listProviders,
  listRoutes,
  createProvider,
  updateProvider,
  toggleProvider,
  deleteProvider,
  testKeyDirect,
  checkProviderHealth,
  refreshUpstreamModels,
  testProviderModel,
} from "../actions";
import { revealKeyBundle } from "@/lib/providers/keys";
import type { ProviderKeyResult } from "@/db/schema/pg";
import { getTranslations } from "next-intl/server";
import ProvidersManager, {
  type ProviderItem,
} from "@/features/providers/ProvidersManager";
import { PROVIDER_PROTOCOLS } from "@/features/providers/protocols";
import { Server } from "lucide-react";
import { PageHeader } from "@/shared/components/PageHeader";

export default async function ProvidersPage() {
  const tn = await getTranslations("nav");
  const t = await getTranslations("admin.providers");
  const rows = await listProviders();
  // 已配路由(用于检测模型悬浮窗标注哪些上游模型已配路由)。
  const routeRows = await listRoutes();
  const routes = routeRows.map((r: Record<string, unknown>) => {
    const route = r.route as Record<string, unknown>;
    return {
      providerId: route.providerId as string,
      upstreamModelName: route.upstreamModelName as string,
    };
  });

  const providers: ProviderItem[] = rows.map((p: Record<string, unknown>) => ({
    id: p.id as string,
    name: p.name as string,
    protocol: p.protocol as string,
    baseUrl: p.baseUrl as string,
    enabled: p.enabled as boolean,
    keyStrategy: p.keyStrategy as string,
    keys: revealKeyBundle(p.apiKeysEnc as string).map((k) => ({
      key: k.key,
      weight: String(k.weight),
    })),
    health: {
      healthy: (p.lastHealthyKeyCount as number | null) ?? null,
      total: (p.lastTotalKeyCount as number | null) ?? null,
      checkedAt: (p.lastHealthCheckedAt as Date | null) ?? null,
      networkOk: (p.lastNetworkOk as boolean | null) ?? null,
      keyResults: (p.lastKeyResults as ProviderKeyResult[] | null) ?? undefined,
      modelProbeOk: (p.lastModelProbeOk as boolean | null) ?? null,
      modelProbeAt: (p.lastModelProbeAt as Date | null) ?? null,
      modelProbeError: (p.lastModelProbeError as string | null) ?? null,
    },
    testModel: (p.testModel as string | null) ?? null,
    upstreamModels: (p.upstreamModels as string[] | null) ?? [],
    upstreamModelsAt: (p.upstreamModelsAt as Date | null) ?? null,
  }));

  // 预先 bind 每个 id 对应的 action,组成按 id 索引的表(传给客户端壳)。
  const updateActions = Object.fromEntries(
    providers.map((p) => [p.id, updateProvider.bind(null, p.id)]),
  );
  const toggleActions = Object.fromEntries(
    providers.map((p) => [p.id, toggleProvider.bind(null, p.id, !p.enabled)]),
  );
  const deleteActions = Object.fromEntries(
    providers.map((p) => [p.id, deleteProvider.bind(null, p.id)]),
  );
  const healthActions = Object.fromEntries(
    providers.map((p) => [p.id, checkProviderHealth.bind(null, p.id)]),
  );
  const refreshActions = Object.fromEntries(
    providers.map((p) => [p.id, refreshUpstreamModels.bind(null, p.id)]),
  );
  const modelProbeActions = Object.fromEntries(
    providers.map((p) => [p.id, testProviderModel.bind(null, p.id)]),
  );

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] gap-4">
      <div className="shrink-0">
        <PageHeader icon={Server} title={tn("globalProviders")} desc={t("desc")} />
      </div>
      <ProvidersManager
          providers={providers}
          protocols={PROVIDER_PROTOCOLS}
          createAction={createProvider}
          updateActions={updateActions}
          toggleActions={toggleActions}
          deleteActions={deleteActions}
          testKeyAction={testKeyDirect}
          healthActions={healthActions}
          refreshActions={refreshActions}
          modelProbeActions={modelProbeActions}
          routes={routes}
        />
    </div>
  );
}
