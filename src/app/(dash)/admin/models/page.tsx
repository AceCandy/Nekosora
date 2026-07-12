import {
  listModels,
  listProviders,
  listRoutes,
  createModel,
  updateModel,
  deleteModel,
  toggleModel,
  createRoute,
  updateRoute,
  deleteRoute,
  toggleRoute,
  listUpstreamModels,
  testRoute,
  reorderModels,
} from "../actions";
import ModelsManager, {
  type ModelItem,
  type RouteItem,
  type ProviderOption,
} from "@/features/models/ModelsManager";
import { getTranslations } from "next-intl/server";
import { Boxes } from "lucide-react";
import { PageHeader } from "@/shared/components/PageHeader";

export default async function ModelsPage() {
  const tn = await getTranslations("nav");
  const t = await getTranslations("admin.models");
  const [models, providers, routes] = await Promise.all([
    listModels(),
    listProviders(),
    listRoutes(),
  ]);

  // —— 映射数据形状,适配 ModelsManager ——
  const modelItems: ModelItem[] = models.map((m: Record<string, unknown>) => ({
    id: m.id as string,
    name: m.name as string,
    displayName: m.displayName as string,
    catalogId: m.catalogId as string,
    catalogName: ((m.catalog as Record<string, unknown>)?.name as string) ?? "-",
    visibility: m.visibility as string,
    enabled: m.enabled as boolean,
    systemPrompt: (m.systemPrompt as string) ?? null,
    description: (m.description as string) ?? null,
    sortOrder: m.sortOrder as number,
  }));

  const routeItems: RouteItem[] = routes.map((r: Record<string, unknown>) => ({
    id: (r.route as Record<string, unknown>).id as string,
    modelId: (r.route as Record<string, unknown>).modelId as string,
    providerId: (r.route as Record<string, unknown>).providerId as string,
    providerName: r.providerName as string,
    upstreamModelName: (r.route as Record<string, unknown>).upstreamModelName as string,
    priority: (r.route as Record<string, unknown>).priority as number,
    weight: (r.route as Record<string, unknown>).weight as number,
    enabled: (r.route as Record<string, unknown>).enabled as boolean,
  }));

  const providerOptions: ProviderOption[] = providers.map((p: Record<string, unknown>) => ({
    id: p.id as string,
    name: p.name as string,
  }));

  // —— 预先 bind 每个 id / modelId 对应的 action,组成按 id 索引的表 ——
  const updateActions = Object.fromEntries(
    modelItems.map((m) => [m.id, updateModel.bind(null, m.id)]),
  );
  const deleteActions = Object.fromEntries(
    modelItems.map((m) => [m.id, deleteModel.bind(null, m.id)]),
  );
  const toggleActions = Object.fromEntries(
    modelItems.map((m) => [m.id, toggleModel.bind(null, m.id, !m.enabled)]),
  );
  // 路由:createRoute 按 modelId bind(每模型一个新增入口,含尚无路由的模型)
  const allModelIds = modelItems.map((m) => m.id);
  const createRouteActions = Object.fromEntries(
    allModelIds.map((mid) => [mid, createRoute.bind(null, mid)]),
  );
  const updateRouteActions = Object.fromEntries(
    routeItems.map((r) => [r.id, updateRoute.bind(null, r.id)]),
  );
  const deleteRouteActions = Object.fromEntries(
    routeItems.map((r) => [r.id, deleteRoute.bind(null, r.id)]),
  );
  const toggleRouteActions = Object.fromEntries(
    routeItems.map((r) => [r.id, toggleRoute.bind(null, r.id, !r.enabled)]),
  );
  const testRouteActions = Object.fromEntries(
    routeItems.map((r) => [r.id, testRoute.bind(null, r.id)]),
  );

  return (
    <div className="space-y-8">
      <PageHeader icon={Boxes} title={tn("globalModels")} desc={t("desc")} />
      <ModelsManager
        isAdmin
        models={modelItems}
        routes={routeItems}
        providers={providerOptions}
        createAction={createModel}
        updateActions={updateActions}
        deleteActions={deleteActions}
        toggleActions={toggleActions}
        createRouteActions={createRouteActions}
        updateRouteActions={updateRouteActions}
        deleteRouteActions={deleteRouteActions}
        toggleRouteActions={toggleRouteActions}
        fetchModelsAction={listUpstreamModels}
        testRouteActions={testRouteActions}
        reorderAction={reorderModels}
      />
    </div>
  );
}
