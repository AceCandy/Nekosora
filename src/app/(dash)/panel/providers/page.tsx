import { getTranslations } from "next-intl/server";
import {
  getMyProviders,
  createMyProvider,
  updateMyProvider,
  toggleMyProvider,
  deleteMyProvider,
  testMyKeyDirect,
  checkMyProviderHealth,
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

  return (
    <div className="space-y-4">
      <PageHeader icon={Server} title={tn("providers")} desc={t("desc")} />
      <ProvidersManager
        providers={providers}
        protocols={PROVIDER_PROTOCOLS}
        createAction={createMyProvider}
        updateActions={updateActions}
          toggleActions={toggleActions}
          deleteActions={deleteActions}
          testKeyAction={testMyKeyDirect}
          healthActions={healthActions}
        />
    </div>
  );
}
