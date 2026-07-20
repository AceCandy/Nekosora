import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { getSettings, upsertSettings } from "@/lib/system-settings/service";
import { resetEmbeddingConfig } from "@/lib/rag/embedding";
import { resetTitleModelConfig } from "@/lib/conversation-title/service";
import { resetCompactModelConfig } from "@/lib/compact/service";
import { requireAdmin } from "@/lib/session";
import EmbeddingConfigForm from "./EmbeddingConfigForm";
import { listUpstreamModelsCached } from "../actions";

/**
 * 模型配置区 —— embedding / 标题生成的系统级配置。
 *
 * 嵌入 admin/settings 页。提交后 upsert system_settings 并清除对应缓存即时生效。
 * provider 列表来自 global_providers(管理员先在 /admin/providers 建好上游)。
 */
export default async function ModelConfigSection({
  labels,
}: {
  labels: {
    title: string;
    desc: string;
    embeddingTitle: string;
    embeddingProvider: string;
    embeddingModel: string;
    embeddingHint: string;
    titleTaskTitle: string;
    titleTaskModel: string;
    titleTaskHint: string;
    compactTaskTitle: string;
    compactTaskModel: string;
    compactTaskHint: string;
    save: string;
    saved: string;
    selectProvider: string;
    noProviders: string;
  };
}) {
  const admin = await requireAdmin();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  // providers 无 visibility,恒 per-user:仅 owner 自己的 enabled provider。
  const providers = await db
    .select({ id: s.providers.id, name: s.providers.name })
    .from(s.providers)
    .where(and(eq(s.providers.enabled, true), eq(s.providers.ownerUserId, admin.id)))
    .orderBy(s.providers.createdAt);

  const rag = await getSettings("rag");
  const task = await getSettings("task");

  async function saveEmbedding(formData: FormData) {
    "use server";
    const providerId = String(formData.get("provider_id") ?? "");
    const model = String(formData.get("model") ?? "").trim();
    await upsertSettings("rag", {
      embedding_provider_id: providerId,
      embedding_model: model,
    });
    resetEmbeddingConfig();
    revalidatePath("/admin/settings");
  }

  async function saveTitleModel(formData: FormData) {
    "use server";
    const model = String(formData.get("model") ?? "").trim();
    await upsertSettings("task", { title_model: model });
    resetTitleModelConfig();
    revalidatePath("/admin/settings");
  }

  async function saveCompactModel(formData: FormData) {
    "use server";
    const model = String(formData.get("model") ?? "").trim();
    await upsertSettings("task", { compact_model: model });
    resetCompactModelConfig();
    revalidatePath("/admin/settings");
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">{labels.title}</h2>
        <p className="mt-1 text-sm text-neutral-500">{labels.desc}</p>
      </div>

      {/* Embedding 配置 */}
      {providers.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 space-y-3">
          <h3 className="text-sm font-bold text-neutral-800 dark:text-white">{labels.embeddingTitle}</h3>
          <p className="text-xs text-amber-600 dark:text-amber-400">{labels.noProviders}</p>
        </div>
      ) : (
        <EmbeddingConfigForm
          providers={providers}
          initialProviderId={rag.embedding_provider_id ?? ""}
          initialModel={rag.embedding_model ?? ""}
          fetchAction={listUpstreamModelsCached}
          action={saveEmbedding}
          labels={{
            embeddingTitle: labels.embeddingTitle,
            embeddingProvider: labels.embeddingProvider,
            embeddingModel: labels.embeddingModel,
            embeddingHint: labels.embeddingHint,
            selectProvider: labels.selectProvider,
            save: labels.save,
          }}
        />
      )}

      {/* 标题生成模型配置 */}
      <form action={saveTitleModel} className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 space-y-3">
        <h3 className="text-sm font-bold text-neutral-800 dark:text-white">{labels.titleTaskTitle}</h3>
        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-500">{labels.titleTaskModel}</label>
          <input
            name="model"
            defaultValue={task.title_model ?? ""}
            placeholder="gpt-4o-mini"
            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:border-sora-blue"
          />
          <p className="text-[11px] text-neutral-400">{labels.titleTaskHint}</p>
        </div>
        <button type="submit" className="rounded-md bg-sora-blue hover:bg-sora-blue-hover text-white px-4 py-2 text-sm font-semibold cursor-pointer">
          {labels.save}
        </button>
      </form>

      {/* 摘要生成模型配置 */}
      <form action={saveCompactModel} className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 space-y-3">
        <h3 className="text-sm font-bold text-neutral-800 dark:text-white">{labels.compactTaskTitle}</h3>
        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-500">{labels.compactTaskModel}</label>
          <input
            name="model"
            defaultValue={task.compact_model ?? ""}
            placeholder="gpt-4o-mini"
            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:border-sora-blue"
          />
          <p className="text-[11px] text-neutral-400">{labels.compactTaskHint}</p>
        </div>
        <button type="submit" className="rounded-md bg-sora-blue hover:bg-sora-blue-hover text-white px-4 py-2 text-sm font-semibold cursor-pointer">
          {labels.save}
        </button>
      </form>
    </div>
  );
}
