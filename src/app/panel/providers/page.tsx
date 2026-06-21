import {
  getMyProviders,
  createMyProvider,
  updateMyProvider,
  toggleMyProvider,
  deleteMyProvider,
} from "../actions";
import { revealKeyBundle } from "@/lib/providers/keys";
import ProvidersManager, {
  type ProviderItem,
} from "@/components/providers/ProvidersManager";

/** BYO 不支持 custom 协议。 */
const PROTOCOLS = [
  { value: "openai", label: "openai(兼容)" },
  { value: "anthropic", label: "anthropic" },
  { value: "gemini", label: "gemini" },
];

export default async function MyProvidersPage() {
  const rows = await getMyProviders();

  const providers: ProviderItem[] = rows.map((p: Record<string, unknown>) => ({
    id: p.id as string,
    name: p.name as string,
    protocol: p.protocol as string,
    baseUrl: p.baseUrl as string,
    enabled: p.enabled as boolean,
    keys: revealKeyBundle(p.apiKeyEnc as string).map((k) => ({
      key: k.key,
      weight: String(k.weight),
    })),
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

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold mb-2">我的 Providers</h1>
        <p className="text-sm text-neutral-500">
          添加你自己的上游 Provider(base_url + key)。这里的 key 会加密存储,仅你可调用。
        </p>
      </div>
      <ProvidersManager
        providers={providers}
        protocols={PROTOCOLS}
        createAction={createMyProvider}
        updateActions={updateActions}
        toggleActions={toggleActions}
        deleteActions={deleteActions}
      />
    </div>
  );
}
