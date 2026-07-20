import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { loadConfig, saveWebSearchConfig } from "@/lib/web-search/registry";
import type { WebSearchConfig, WebSearchProviderConfig } from "@/lib/web-search/types";
import WebSearchManager, { type WebSearchProviderInput } from "@/features/web-search/WebSearchManager";
import { Globe } from "lucide-react";
import { PageHeader } from "@/shared/components/PageHeader";

/** 空配置(每次返回新对象,避免污染缓存引用)。 */
function emptyConfig(): WebSearchConfig {
  return { version: 1, providers: [] };
}

export default async function WebSearchPage() {
  const user = await requireSession();
  const userId = user.id;
  const t = await getTranslations("panel.webSearch");
  const tn = await getTranslations("nav");
  const config = (await loadConfig(userId)) ?? emptyConfig();

  // 新增 provider(默认 enabled,取首个 enabled 生效)。
  async function createProvider(input: WebSearchProviderInput & { enabled: boolean }) {
    "use server";
    const cfg = (await loadConfig(userId)) ?? emptyConfig();
    const provider: WebSearchProviderConfig = { id: crypto.randomUUID(), ...input };
    cfg.providers.push(provider);
    await saveWebSearchConfig(userId, cfg);
    revalidatePath("/panel", "layout");
  }

  // 更新 provider 字段(保留 id/enabled)。
  async function updateProvider(id: string, input: WebSearchProviderInput) {
    "use server";
    const cfg = (await loadConfig(userId)) ?? emptyConfig();
    const idx = cfg.providers.findIndex((p) => p.id === id);
    if (idx < 0) return;
    cfg.providers[idx] = { ...cfg.providers[idx], ...input };
    await saveWebSearchConfig(userId, cfg);
    revalidatePath("/panel", "layout");
  }

  // 启停 provider。
  async function toggleProvider(id: string, enabled: boolean) {
    "use server";
    const cfg = (await loadConfig(userId)) ?? emptyConfig();
    const p = cfg.providers.find((x) => x.id === id);
    if (!p) return;
    p.enabled = enabled;
    await saveWebSearchConfig(userId, cfg);
    revalidatePath("/panel", "layout");
  }

  // 删除 provider。
  async function deleteProvider(id: string) {
    "use server";
    const cfg = (await loadConfig(userId)) ?? emptyConfig();
    cfg.providers = cfg.providers.filter((p) => p.id !== id);
    await saveWebSearchConfig(userId, cfg);
    revalidatePath("/panel", "layout");
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={Globe} title={tn("webSearch")} desc={t("desc")} />
      <WebSearchManager
        providers={config.providers}
        createAction={createProvider}
        updateAction={updateProvider}
        toggleAction={toggleProvider}
        deleteAction={deleteProvider}
      />
    </div>
  );
}
