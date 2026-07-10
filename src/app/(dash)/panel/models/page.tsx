import {
  getMyModels,
  getMyProviders,
  createMyModel,
  updateMyModel,
  deleteMyModel,
  toggleMyModel,
  reorderMyModels,
  createMyRoute,
  updateMyRoute,
  deleteMyRoute,
  toggleMyRoute,
  listMyUpstreamModels,
  testMyRoute,
} from "../actions";
import ModelsManager, {
  type ModelItem,
  type RouteItem,
  type ProviderOption,
} from "@/features/models/ModelsManager";
import type { ModelCapabilities } from "@/db/types";
import { getTranslations } from "next-intl/server";

export default async function MyModelsPage() {
  const t = await getTranslations("panel.models");
  const tn = await getTranslations("nav");
  const [models, providers] = await Promise.all([getMyModels(), getMyProviders()]);

  // —— 映射数据形状,适配 ModelsManager ——
  const modelItems: ModelItem[] = models.map((r: Record<string, unknown>) => ({
    id: (r.model as Record<string, unknown>).id as string,
    name: (r.model as Record<string, unknown>).name as string,
    displayName: (r.model as Record<string, unknown>).displayName as string,
    vendor: ((r.model as Record<string, unknown>).vendor as string) ?? null,
    enabled: (r.model as Record<string, unknown>).enabled as boolean,
    systemPrompt: ((r.model as Record<string, unknown>).systemPrompt as string) ?? null,
    description: ((r.model as Record<string, unknown>).description as string) ?? null,
    capabilities: ((r.model as Record<string, unknown>).capabilities as ModelCapabilities) ?? null,
    sortOrder: (r.model as Record<string, unknown>).sortOrder as number,
  }));

  // byo 路由外键是 userModelId(对应 global 的 modelId),映射到 RouteItem.modelId。
  const routeItems: RouteItem[] = models.flatMap((r: Record<string, unknown>) =>
    ((r.routes as Record<string, unknown>[]) ?? []).map((rr) => {
      const route = rr.route as Record<string, unknown>;
      return {
        id: route.id as string,
        modelId: route.userModelId as string,
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

  // —— 预先 bind 每个 id / userModelId 对应的 action,组成按 id 索引的表 ——
  const updateActions = Object.fromEntries(
    modelItems.map((m) => [m.id, updateMyModel.bind(null, m.id)]),
  );
  const deleteActions = Object.fromEntries(
    modelItems.map((m) => [m.id, deleteMyModel.bind(null, m.id)]),
  );
  const toggleActions = Object.fromEntries(
    modelItems.map((m) => [m.id, toggleMyModel.bind(null, m.id, !m.enabled)]),
  );
  // 路由:createMyRoute 按 userModelId bind(每模型一个新增入口,含尚无路由的模型)
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold mb-2">{tn("models")}</h1>
        <p className="text-sm text-neutral-500">
          {t("desc")}
        </p>
      </div>
      {providers.length === 0 ? (
        <p className="text-sm text-amber-600">{t("needProvider")}</p>
      ) : (
        <ModelsManager
          variant="byo"
          models={modelItems}
          routes={routeItems}
          providers={providerOptions}
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
          reorderAction={reorderMyModels}
        />
      )}
    </div>
  );
}
