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
} from "../actions";
import ModelsManager, {
  type ModelItem,
  type RouteItem,
  type ProviderOption,
} from "@/features/models/ModelsManager";
import type { ModelCapabilities } from "@/db/types";
import { getTranslations } from "next-intl/server";

const PROTOCOLS = [
  { value: "openai", label: "openai" },
  { value: "anthropic", label: "anthropic" },
  { value: "gemini", label: "gemini" },
  { value: "custom", label: "custom" },
];

export default async function ModelsPage() {
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
    vendor: (m.vendor as string) ?? null,
    accessScope: m.accessScope as string,
    enabled: m.enabled as boolean,
    systemPrompt: (m.systemPrompt as string) ?? null,
    description: (m.description as string) ?? null,
    capabilities: (m.capabilities as ModelCapabilities) ?? null,
  }));

  const routeItems: RouteItem[] = routes.map((r: Record<string, unknown>) => ({
    id: (r.route as Record<string, unknown>).id as string,
    modelId: (r.route as Record<string, unknown>).modelId as string,
    providerId: (r.route as Record<string, unknown>).providerId as string,
    providerName: r.providerName as string,
    upstreamModelName: (r.route as Record<string, unknown>).upstreamModelName as string,
    protocol: (r.route as Record<string, unknown>).protocol as string,
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold mb-2">{t("title")}</h1>
        <p className="text-sm text-neutral-500 mb-4">
          {t("title")}
        </p>
      </div>
      <ModelsManager
        variant="global"
        models={modelItems}
        routes={routeItems}
        providers={providerOptions}
        protocols={PROTOCOLS}
        createAction={createModel}
        updateActions={updateActions}
        deleteActions={deleteActions}
        toggleActions={toggleActions}
        createRouteActions={createRouteActions}
        updateRouteActions={updateRouteActions}
        deleteRouteActions={deleteRouteActions}
        toggleRouteActions={toggleRouteActions}
      />
    </div>
  );
}
