import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import {
  createDefaultWebSearchConfig,
  listWebSearchModelCandidates,
  listWebSearchQueryModelCandidates,
  loadConfig,
  saveWebSearchConfig,
  toWebSearchConfigDto,
} from "@/lib/web-search/registry";
import { searchBackendKey, type SearchBackend, type WebSearchProviderConfig } from "@/lib/web-search/types";
import WebSearchManager, { type WebSearchProviderInput } from "@/features/web-search/WebSearchManager";
import { Globe } from "lucide-react";
import { PageHeader } from "@/shared/components/PageHeader";

const providerInputSchema = z.object({
  type: z.enum(["tavily", "exa", "bocha", "zhipu", "searxng"]),
  name: z.string().trim().min(1).max(100),
  apiKey: z.string().trim().min(1).max(10_000).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  baseUrl: z.string().trim().min(1).max(2_048).optional(),
}).strict();
const backendListSchema = z.array(z.discriminatedUnion("type", [
  z.object({ type: z.literal("current-model") }).strict(),
  z.object({ type: z.literal("model"), modelId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("provider"), providerId: z.string().min(1) }).strict(),
]));
const idSchema = z.string().min(1);

async function loadCurrentUserConfig() {
  const user = await requireSession();
  return { userId: user.id, config: (await loadConfig(user.id)) ?? createDefaultWebSearchConfig() };
}

export default async function WebSearchPage() {
  const { userId, config } = await loadCurrentUserConfig();
  const [modelCandidates, queryRewriteModelCandidates] = await Promise.all([
    listWebSearchModelCandidates(userId),
    listWebSearchQueryModelCandidates(userId),
  ]);
  const t = await getTranslations("panel.webSearch");
  const tn = await getTranslations("nav");

  async function createProvider(input: WebSearchProviderInput) {
    "use server";
    const parsed = providerInputSchema.safeParse(input);
    if (!parsed.success) throw new Error("搜索源配置无效");
    const { userId, config: current } = await loadCurrentUserConfig();
    const provider: WebSearchProviderConfig = {
      id: crypto.randomUUID(),
      ...parsed.data,
      enabled: true,
    };
    current.providers.push(provider);
    current.backends.push({ type: "provider", providerId: provider.id });
    await saveWebSearchConfig(userId, current);
    revalidatePath("/panel/web-search");
  }

  async function updateProvider(id: string, input: WebSearchProviderInput) {
    "use server";
    const parsedId = idSchema.safeParse(id);
    const parsed = providerInputSchema.safeParse(input);
    if (!parsedId.success || !parsed.success) throw new Error("搜索源配置无效");
    const { userId, config: current } = await loadCurrentUserConfig();
    const index = current.providers.findIndex((provider) => provider.id === parsedId.data);
    if (index < 0) throw new Error("搜索源不存在");
    const existing = current.providers[index];
    const next = parsed.data;
    current.providers[index] = {
      ...existing,
      ...next,
      apiKey: next.type === "searxng" ? undefined : next.apiKey || existing.apiKey,
      model: next.type === "zhipu" ? next.model : undefined,
      baseUrl: next.type === "searxng" ? next.baseUrl : undefined,
    };
    await saveWebSearchConfig(userId, current);
    revalidatePath("/panel/web-search");
  }

  async function toggleProvider(id: string, enabled: boolean) {
    "use server";
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success || typeof enabled !== "boolean") throw new Error("搜索源配置无效");
    const { userId, config: current } = await loadCurrentUserConfig();
    const provider = current.providers.find((item) => item.id === parsedId.data);
    if (!provider) throw new Error("搜索源不存在");
    provider.enabled = enabled;
    await saveWebSearchConfig(userId, current);
    revalidatePath("/panel/web-search");
  }

  async function deleteProvider(id: string) {
    "use server";
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) throw new Error("搜索源配置无效");
    const { userId, config: current } = await loadCurrentUserConfig();
    if (!current.providers.some((provider) => provider.id === parsedId.data)) {
      throw new Error("搜索源不存在");
    }
    current.providers = current.providers.filter((provider) => provider.id !== parsedId.data);
    current.backends = current.backends.filter(
      (backend) => backend.type !== "provider" || backend.providerId !== parsedId.data,
    );
    await saveWebSearchConfig(userId, current);
    revalidatePath("/panel/web-search");
  }

  async function reorderBackends(backends: SearchBackend[]) {
    "use server";
    const parsed = backendListSchema.safeParse(backends);
    if (!parsed.success) throw new Error("搜索顺序无效");
    const { userId, config: current } = await loadCurrentUserConfig();
    const allowed = new Set(current.backends.map(searchBackendKey));
    const submitted = new Set(parsed.data.map(searchBackendKey));
    if (
      parsed.data.length !== submitted.size
      || allowed.size !== submitted.size
      || [...allowed].some((key) => !submitted.has(key))
    ) throw new Error("搜索顺序无效");
    current.backends = parsed.data;
    await saveWebSearchConfig(userId, current);
    revalidatePath("/panel/web-search");
  }

  async function addModelBackend(modelId: string) {
    "use server";
    const parsedId = idSchema.safeParse(modelId);
    if (!parsedId.success) throw new Error("搜索模型无效");
    const { userId, config: current } = await loadCurrentUserConfig();
    const candidates = await listWebSearchModelCandidates(userId);
    if (!candidates.some((model) => model.id === parsedId.data)) {
      throw new Error("搜索模型不可用");
    }
    if (!current.backends.some(
      (backend) => backend.type === "model" && backend.modelId === parsedId.data,
    )) current.backends.push({ type: "model", modelId: parsedId.data });
    await saveWebSearchConfig(userId, current);
    revalidatePath("/panel/web-search");
  }

  async function removeModelBackend(modelId: string) {
    "use server";
    const parsedId = idSchema.safeParse(modelId);
    if (!parsedId.success) throw new Error("搜索模型无效");
    const { userId, config: current } = await loadCurrentUserConfig();
    current.backends = current.backends.filter(
      (backend) => backend.type !== "model" || backend.modelId !== parsedId.data,
    );
    await saveWebSearchConfig(userId, current);
    revalidatePath("/panel/web-search");
  }

  async function saveQueryRewriteModel(modelId: string) {
    "use server";
    const parsed = z.string().trim().safeParse(modelId);
    if (!parsed.success) throw new Error("搜索词提炼模型无效");
    const { userId, config: current } = await loadCurrentUserConfig();
    const candidates = await listWebSearchQueryModelCandidates(userId);
    if (parsed.data && !candidates.some((model) => model.id === parsed.data)) {
      throw new Error("搜索词提炼模型不可用");
    }
    current.queryRewriteModelId = parsed.data || undefined;
    await saveWebSearchConfig(userId, current);
    revalidatePath("/panel/web-search");
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={Globe} title={tn("webSearch")} desc={t("desc")} />
      <WebSearchManager
        config={toWebSearchConfigDto(config)}
        modelCandidates={modelCandidates}
        queryRewriteModelCandidates={queryRewriteModelCandidates}
        createAction={createProvider}
        updateAction={updateProvider}
        toggleAction={toggleProvider}
        deleteAction={deleteProvider}
        reorderAction={reorderBackends}
        addModelAction={addModelBackend}
        removeModelAction={removeModelBackend}
        saveQueryRewriteModelAction={saveQueryRewriteModel}
      />
    </div>
  );
}
