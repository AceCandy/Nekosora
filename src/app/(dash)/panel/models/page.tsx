import {
  getMyModels,
  getMyProviders,
  createMyModel,
  updateMyModel,
  deleteMyModel,
  toggleMyModel,
  listMyUpstreamModels,
  testMyModel,
} from "../actions";
import ModelsManager, {
  type ModelItem,
  type ProviderOption,
} from "@/features/models/ModelsManager";
import type { ModelCapabilities } from "@/db/types";
import { getTranslations } from "next-intl/server";

export default async function MyModelsPage() {
  const t = await getTranslations("panel.models");
  const tn = await getTranslations("nav");
  const [models, providers] = await Promise.all([getMyModels(), getMyProviders()]);

  // —— 映射数据形状 ——
  const modelItems: ModelItem[] = models.map((r: Record<string, unknown>) => ({
    id: (r.model as Record<string, unknown>).id as string,
    name: (r.model as Record<string, unknown>).name as string,
    upstreamModelName: (r.model as Record<string, unknown>).upstreamModelName as string,
    providerId: (r.model as Record<string, unknown>).providerId as string,
    providerName: r.providerName as string,
    enabled: (r.model as Record<string, unknown>).enabled as boolean,
    capabilities: ((r.model as Record<string, unknown>).capabilities as ModelCapabilities) ?? null,
  }));

  const byoProviders: ProviderOption[] = providers.map((p: Record<string, unknown>) => ({
    id: p.id as string,
    name: p.name as string,
  }));

  // —— bind 按 id 索引的 action 表 ——
  const updateActions = Object.fromEntries(
    modelItems.map((m) => [m.id, updateMyModel.bind(null, m.id)]),
  );
  const deleteActions = Object.fromEntries(
    modelItems.map((m) => [m.id, deleteMyModel.bind(null, m.id)]),
  );
  const toggleActions = Object.fromEntries(
    modelItems.map((m) => [m.id, toggleMyModel.bind(null, m.id, !m.enabled)]),
  );
  const testModelActions = Object.fromEntries(
    modelItems.map((m) => [m.id, testMyModel.bind(null, m.id)]),
  );

  return (
    <div className="space-y-8 max-w-3xl">
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
          byoProviders={byoProviders}
          createAction={createMyModel}
          updateActions={updateActions}
          deleteActions={deleteActions}
          toggleActions={toggleActions}
          fetchModelsAction={listMyUpstreamModels}
          testModelActions={testModelActions}
        />
      )}
    </div>
  );
}
