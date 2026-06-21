import {
  getMyModels,
  getMyProviders,
  createMyModel,
  updateMyModel,
  deleteMyModel,
  toggleMyModel,
} from "../actions";
import ModelsManager, {
  type ModelItem,
  type ProviderOption,
} from "@/components/models/ModelsManager";
import type { ModelCapabilities } from "@/db/types";

export default async function MyModelsPage() {
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

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold mb-2">我的 Models</h1>
        <p className="text-sm text-neutral-500">
          在你的 Provider 上定义模型(对外名 + 上游真实名)。这些模型可绑定到子密钥,或在 Chat 中使用。
        </p>
      </div>
      {providers.length === 0 ? (
        <p className="text-sm text-amber-600">请先在「我的 Providers」添加至少一个 Provider。</p>
      ) : (
        <ModelsManager
          variant="byo"
          models={modelItems}
          byoProviders={byoProviders}
          createAction={createMyModel}
          updateActions={updateActions}
          deleteActions={deleteActions}
          toggleActions={toggleActions}
        />
      )}
    </div>
  );
}
