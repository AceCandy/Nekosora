import {
  listProviders,
  createProvider,
  updateProvider,
  toggleProvider,
  deleteProvider,
  testKeyDirect,
  checkProviderHealth,
} from "../actions";
import { revealKeyBundle } from "@/lib/providers/keys";
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

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <PageHeader icon={Server} title={tn("globalProviders")} desc={t("desc")} />
        <ProvidersManager
          providers={providers}
          protocols={PROVIDER_PROTOCOLS}
          createAction={createProvider}
          updateActions={updateActions}
          toggleActions={toggleActions}
          deleteActions={deleteActions}
          testKeyAction={testKeyDirect}
          healthActions={healthActions}
        />
      </div>
    </div>
  );
}
