import {
  getMyModels,
  getMyProviders,
  createMyModel,
  updateMyModel,
  deleteMyModel,
  toggleMyModel,
  reorderMyModels,
  setMyModelVisibility,
  createMyRoute,
  updateMyRoute,
  deleteMyRoute,
  toggleMyRoute,
  listMyUpstreamModels,
  testMyRoute,
  listModelCatalog,
} from "../actions";
import ModelsManager, {
  type ModelItem,
  type RouteItem,
  type ProviderOption,
} from "@/features/models/ModelsManager";
import type { ModelCapabilities } from "@/db/types";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session";
import { Boxes } from "lucide-react";
import { PageHeader } from "@/shared/components/PageHeader";

export default async function MyModelsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("panel.models");
  const tn = await getTranslations("nav");
  const user = await requireSession();
  const isAdmin = user.role === "admin";
  const query = (await searchParams) ?? {};
  const queryValue = (key: string) => (Array.isArray(query[key]) ? query[key]?.[0] : query[key]) ?? "";
  const [models, providers, catalog] = await Promise.all([
    getMyModels(),
    getMyProviders(),
    listModelCatalog(),
  ]);

  // —— 映射数据形状,适配 ModelsManager ——
  const modelItems: ModelItem[] = models.map((r: Record<string, unknown>) => ({
    id: (r.model as Record<string, unknown>).id as string,
    name: (r.model as Record<string, unknown>).name as string,
    displayName: (r.model as Record<string, unknown>).displayName as string,
    catalogId: (r.model as Record<string, unknown>).catalogId as string,
    catalogName: (((r.model as Record<string, unknown>).catalog as Record<string, unknown>).name as string),
    visibility: (r.model as Record<string, unknown>).visibility as string,
    enabled: (r.model as Record<string, unknown>).enabled as boolean,
    systemPrompt: ((r.model as Record<string, unknown>).systemPrompt as string) ?? null,
    description: ((r.model as Record<string, unknown>).description as string) ?? null,
    capabilities: ((r.model as Record<string, unknown>).capabilities as ModelCapabilities) ?? null,
    sortOrder: (r.model as Record<string, unknown>).sortOrder as number,
  }));

  // 路由外键统一为 modelId(原 byo 的 userModelId 已收敛)。
  const routeItems: RouteItem[] = models.flatMap((r: Record<string, unknown>) =>
    ((r.routes as Record<string, unknown>[]) ?? []).map((rr) => {
      const route = rr.route as Record<string, unknown>;
      return {
        id: route.id as string,
        modelId: route.modelId as string,
        providerId: route.providerId as string,
        providerName: rr.providerName as string,
        upstreamModelName: route.upstreamModelName as string,
        priority: route.priority as number,
        weight: route.weight as number,
        enabled: route.enabled as boolean,
      };
    }),
  );

  const providerOptions: ProviderOption[] = providers.map((p: Record<string, unknown>) => ({
    id: p.id as string,
    name: p.name as string,
  }));

  // —— 预先 bind 每个 id / modelId 对应的 action,组成按 id 索引的表 ——
  const updateActions = Object.fromEntries(
    modelItems.map((m) => [m.id, updateMyModel.bind(null, m.id)]),
  );
  const deleteActions = Object.fromEntries(
    modelItems.map((m) => [m.id, deleteMyModel.bind(null, m.id)]),
  );
  const toggleActions = Object.fromEntries(
    modelItems.map((m) => [m.id, toggleMyModel.bind(null, m.id, !m.enabled)]),
  );
  // 路由:createMyRoute 按 modelId bind(每模型一个新增入口,含尚无路由的模型)
  const createRouteActions = Object.fromEntries(
    modelItems.map((m) => [m.id, createMyRoute.bind(null, m.id)]),
  );
  const updateRouteActions = Object.fromEntries(
    routeItems.map((r) => [r.id, updateMyRoute.bind(null, r.id)]),
  );
  const deleteRouteActions = Object.fromEntries(
    routeItems.map((r) => [r.id, deleteMyRoute.bind(null, r.id)]),
  );
  const toggleRouteActions = Object.fromEntries(
    routeItems.map((r) => [r.id, toggleMyRoute.bind(null, r.id, !r.enabled)]),
  );
  const testRouteActions = Object.fromEntries(
    routeItems.map((r) => [r.id, testMyRoute.bind(null, r.id)]),
  );
  const visibilityActions = Object.fromEntries(
    modelItems.map((m) => [
      m.id,
      {
        publish: setMyModelVisibility.bind(null, m.id, "public"),
        makePrivate: setMyModelVisibility.bind(null, m.id, "private"),
      },
    ]),
  );

  return (
    <div className="space-y-8">
      <PageHeader icon={Boxes} title={tn("models")} desc={t("desc")} />
      {providers.length === 0 ? (
        <p className="text-ui-body text-amber-600">{t("needProvider")}</p>
      ) : (
        <ModelsManager
          isAdmin={isAdmin}
          models={modelItems}
          routes={routeItems}
          providers={providerOptions}
          catalog={catalog.map((entry: Record<string, unknown>) => ({
            id: entry.id as string,
            name: entry.name as string,
            modelType: entry.modelType as string,
            capabilities: (entry.capabilities as ModelCapabilities) ?? {},
          }))}
          createAction={createMyModel}
          updateActions={updateActions}
          deleteActions={deleteActions}
          toggleActions={toggleActions}
          createRouteActions={createRouteActions}
          updateRouteActions={updateRouteActions}
          deleteRouteActions={deleteRouteActions}
          toggleRouteActions={toggleRouteActions}
          fetchModelsAction={listMyUpstreamModels}
          testRouteActions={testRouteActions}
          reorderAction={reorderMyModels.bind(null, "private")}
          groupedReorderAction={isAdmin ? reorderMyModels : undefined}
          visibilityActions={isAdmin ? visibilityActions : undefined}
          createInitial={queryValue("createModel") === "1" ? {
            name: queryValue("name"),
            providerId: queryValue("providerId"),
            upstreamModelName: queryValue("upstreamModelName"),
          } : undefined}
        />
      )}
    </div>
  );
}
