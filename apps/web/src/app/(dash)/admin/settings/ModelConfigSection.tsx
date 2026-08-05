import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { getSettings, upsertSettings } from "@/lib/system-settings/service";
import { resetTitleModelConfig } from "@/lib/conversation-title/service";
import { resetCompactModelConfig } from "@/lib/compact/service";
import { resetMemoryClient } from "@/lib/memory/mem0";
import { requireAdmin } from "@/lib/session";
import EmbeddingConfigForm from "./EmbeddingConfigForm";
import BackgroundModelConfigForm from "./BackgroundModelConfigForm";
import { saveEmbedding } from "./actions";
import { listUpstreamModelsCached } from "../actions";

/** Server Action 边界校验：后台任务只允许选择可路由的公共模型。 */
async function assertBackgroundModelId(modelId: string): Promise<void> {
  if (!modelId) return;
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [model] = await db
    .select({ id: s.models.id })
    .from(s.models)
    .innerJoin(s.routes, eq(s.routes.modelId, s.models.id))
    .innerJoin(s.providers, eq(s.providers.id, s.routes.providerId))
    .where(and(
      eq(s.models.id, modelId),
      eq(s.models.visibility, "public"),
      eq(s.models.enabled, true),
      eq(s.routes.enabled, true),
      eq(s.providers.enabled, true),
    ))
    .limit(1);
  if (!model) throw new Error("所选模型不存在或不可用于后台任务");
}

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
    titleTaskAuto: string;
    compactTaskTitle: string;
    compactTaskModel: string;
    compactTaskHint: string;
    compactTaskAuto: string;
    mem0LlmTitle: string;
    mem0LlmModel: string;
    mem0LlmHint: string;
    mem0LlmAuto: string;
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

  const backgroundModelRows = await db
    .select({ id: s.models.id, name: s.models.name, displayName: s.models.displayName })
    .from(s.models)
    .innerJoin(s.routes, eq(s.routes.modelId, s.models.id))
    .innerJoin(s.providers, eq(s.providers.id, s.routes.providerId))
    .where(and(
      eq(s.models.visibility, "public"),
      eq(s.models.enabled, true),
      eq(s.routes.enabled, true),
      eq(s.providers.enabled, true),
    ))
    .orderBy(s.models.sortOrder);
  const backgroundModels = Array.from(
    new Map(
      (backgroundModelRows as { id: string; name: string; displayName: string | null }[])
        .map((model) => [model.id, model]),
    ).values(),
  );
  const [rag, task] = await Promise.all([getSettings("rag"), getSettings("task")]);
  const titleModelId =
    task.title_model_id ?? backgroundModels.find((model) => model.name === task.title_model)?.id ?? "";
  const compactModelId =
    task.compact_model_id ?? backgroundModels.find((model) => model.name === task.compact_model)?.id ?? "";
  const mem0ModelId =
    rag.mem0_llm_model_id ?? backgroundModels.find((model) => model.name === rag.mem0_llm_model)?.id ?? "";

  async function saveTitleModel(formData: FormData) {
    "use server";
    await requireAdmin();
    const modelId = String(formData.get("model_id") ?? "").trim();
    await assertBackgroundModelId(modelId);
    await upsertSettings("task", { title_model_id: modelId, title_model: "" });
    resetTitleModelConfig();
    revalidatePath("/admin/settings");
  }

  async function saveCompactModel(formData: FormData) {
    "use server";
    await requireAdmin();
    const modelId = String(formData.get("model_id") ?? "").trim();
    await assertBackgroundModelId(modelId);
    await upsertSettings("task", { compact_model_id: modelId, compact_model: "" });
    resetCompactModelConfig();
    revalidatePath("/admin/settings");
  }

  async function saveMem0LlmModel(formData: FormData) {
    "use server";
    await requireAdmin();
    const modelId = String(formData.get("model_id") ?? "").trim();
    await assertBackgroundModelId(modelId);
    await upsertSettings("rag", { mem0_llm_model_id: modelId, mem0_llm_model: "" });
    resetMemoryClient();
    revalidatePath("/admin/settings");
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-ui-title font-semibold text-neutral-900 dark:text-white">{labels.title}</h2>
        <p className="mt-1 text-ui-body text-neutral-500">{labels.desc}</p>
      </div>

      {/* Embedding 配置 */}
      {providers.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 space-y-3">
          <h3 className="text-ui-body font-bold text-neutral-800 dark:text-white">{labels.embeddingTitle}</h3>
          <p className="text-ui-caption text-amber-600 dark:text-amber-400">{labels.noProviders}</p>
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

      <BackgroundModelConfigForm
        key={`title:${titleModelId}`}
        id="title-model-id"
        title={labels.titleTaskTitle}
        modelLabel={labels.titleTaskModel}
        hint={labels.titleTaskHint}
        autoLabel={labels.titleTaskAuto}
        saveLabel={labels.save}
        models={backgroundModels}
        initialModelId={titleModelId}
        action={saveTitleModel}
      />

      <BackgroundModelConfigForm
        key={`compact:${compactModelId}`}
        id="compact-model-id"
        title={labels.compactTaskTitle}
        modelLabel={labels.compactTaskModel}
        hint={labels.compactTaskHint}
        autoLabel={labels.compactTaskAuto}
        saveLabel={labels.save}
        models={backgroundModels}
        initialModelId={compactModelId}
        action={saveCompactModel}
      />

      <BackgroundModelConfigForm
        key={`mem0:${mem0ModelId}`}
        id="mem0-model-id"
        title={labels.mem0LlmTitle}
        modelLabel={labels.mem0LlmModel}
        hint={labels.mem0LlmHint}
        autoLabel={labels.mem0LlmAuto}
        saveLabel={labels.save}
        models={backgroundModels}
        initialModelId={mem0ModelId}
        action={saveMem0LlmModel}
      />
    </div>
  );
}
