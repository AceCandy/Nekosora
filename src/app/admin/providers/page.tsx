import {
  listProviders,
  createProvider,
  updateProvider,
  toggleProvider,
  deleteProvider,
} from "../actions";
import { revealKeyBundle } from "@/lib/providers/keys";
import { getTranslations } from "next-intl/server";
import ProvidersManager, {
  type ProviderItem,
} from "@/features/providers/ProvidersManager";

const PROTOCOLS = [
  { value: "openai", label: "openai" },
  { value: "anthropic", label: "anthropic" },
  { value: "gemini", label: "gemini" },
  { value: "custom", label: "custom" },
];

export default async function ProvidersPage() {
  const t = await getTranslations("admin.providers");
  const rows = await listProviders();

  const providers: ProviderItem[] = rows.map((p: Record<string, unknown>) => ({
    id: p.id as string,
    name: p.name as string,
    protocol: p.protocol as string,
    baseUrl: p.baseUrl as string,
    enabled: p.enabled as boolean,
    keys: revealKeyBundle(p.apiKeysEnc as string).map((k) => ({
      key: k.key,
      weight: String(k.weight),
    })),
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold mb-4">{t("title")}</h1>
        <ProvidersManager
          providers={providers}
          protocols={PROTOCOLS}
          createAction={createProvider}
          updateActions={updateActions}
          toggleActions={toggleActions}
          deleteActions={deleteActions}
        />
      </div>
    </div>
  );
}
