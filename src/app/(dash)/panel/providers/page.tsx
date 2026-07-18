import { getTranslations } from "next-intl/server";
import {
  getMyProviders,
  listMyRoutes,
  createMyProvider,
  updateMyProvider,
  toggleMyProvider,
  deleteMyProvider,
  testMyKeyDirect,
  checkMyProviderHealth,
  refreshMyUpstreamModels,
} from "../actions";
import { revealKeyBundle } from "@/lib/providers/keys";
import ProvidersManager, {
  type ProviderItem,
} from "@/features/providers/ProvidersManager";
import { PROVIDER_PROTOCOLS } from "@/features/providers/protocols";
import { Server } from "lucide-react";
import { PageHeader } from "@/shared/components/PageHeader";

export default async function MyProvidersPage() {
  const t = await getTranslations("panel.providers");
  const tn = await getTranslations("nav");
  const rows = await getMyProviders();
  // 已配路由(用于检测模型悬浮窗标注哪些上游模型已配路由)。
  const routeRows = await listMyRoutes();
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
    },
    testModel: (p.testModel as string | null) ?? null,
    upstreamModels: (p.upstreamModels as string[] | null) ?? [],
    upstreamModelsAt: (p.upstreamModelsAt as Date | null) ?? null,
  }));

  const updateActions = Object.fromEntries(
    providers.map((p) => [p.id, updateMyProvider.bind(null, p.id)]),
  );
  const toggleActions = Object.fromEntries(
    providers.map((p) => [p.id, toggleMyProvider.bind(null, p.id, !p.enabled)]),
  );
  const deleteActions = Object.fromEntries(
    providers.map((p) => [p.id, deleteMyProvider.bind(null, p.id)]),
  );
  const healthActions = Object.fromEntries(
    providers.map((p) => [p.id, checkMyProviderHealth.bind(null, p.id)]),
  );
  const refreshActions = Object.fromEntries(
    providers.map((p) => [p.id, refreshMyUpstreamModels.bind(null, p.id)]),
  );

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] gap-4">
      <div className="shrink-0">
        <PageHeader icon={Server} title={tn("providers")} desc={t("desc")} />
      </div>
      <ProvidersManager
        providers={providers}
        protocols={PROVIDER_PROTOCOLS}
        createAction={createMyProvider}
        updateActions={updateActions}
          toggleActions={toggleActions}
          deleteActions={deleteActions}
          testKeyAction={testMyKeyDirect}
          healthActions={healthActions}
          refreshActions={refreshActions}
          routes={routes}
        />
    </div>
  );
}
