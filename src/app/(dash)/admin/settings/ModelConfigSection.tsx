import { eq, and } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { getSettings, upsertSettings } from "@/lib/system-settings/service";
import { resetEmbeddingConfig } from "@/lib/rag/embedding";
import { clearWebSearchConfigCache } from "@/lib/web-search/registry";
import { resetTitleModelConfig } from "@/lib/conversation-title/service";
import { resetCompactModelConfig } from "@/lib/compact/service";
import { requireAdmin } from "@/lib/session";

/**
 * 模型配置区 —— embedding / 联网搜索 / 标题生成的系统级配置。
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
    webSearchTitle: string;
    webSearchProvider: string;
    webSearchApiKey: string;
    webSearchModel: string;
    webSearchHint: string;
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
  const ws = await getSettings("web_search");
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
  }

  async function saveWebSearch(formData: FormData) {
    "use server";
    const provider = String(formData.get("provider") ?? "");
    const apiKey = String(formData.get("api_key") ?? "").trim();
    const model = String(formData.get("model") ?? "").trim();
    await upsertSettings("web_search", {
      provider,
      api_key: apiKey,
      model,
    });
    clearWebSearchConfigCache();
  }

  async function saveTitleModel(formData: FormData) {
    "use server";
    const model = String(formData.get("model") ?? "").trim();
    await upsertSettings("task", { title_model: model });
    resetTitleModelConfig();
  }

  async function saveCompactModel(formData: FormData) {
    "use server";
    const model = String(formData.get("model") ?? "").trim();
    await upsertSettings("task", { compact_model: model });
    resetCompactModelConfig();
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">{labels.title}</h2>
        <p className="mt-1 text-sm text-neutral-500">{labels.desc}</p>
      </div>

      {/* Embedding 配置 */}
      <form action={saveEmbedding} className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 space-y-3">
        <h3 className="text-sm font-bold text-neutral-800 dark:text-white">{labels.embeddingTitle}</h3>
        {providers.length === 0 ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">{labels.noProviders}</p>
        ) : (
          <>
            <div className="space-y-1">
              <label className="text-xs font-medium text-neutral-500">{labels.embeddingProvider}</label>
              <select
                name="provider_id"
                defaultValue={rag.embedding_provider_id ?? ""}
                className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-sora-blue cursor-pointer"
              >
                <option value="">{labels.selectProvider}</option>
                {providers.map((p: { id: string; name: string }) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-neutral-500">{labels.embeddingModel}</label>
              <input
                name="model"
                defaultValue={rag.embedding_model ?? ""}
                placeholder="text-embedding-3-small"
                className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:border-sora-blue"
              />
              <p className="text-[11px] text-neutral-400">{labels.embeddingHint}</p>
            </div>
            <button type="submit" className="rounded-md bg-sora-blue hover:bg-sora-blue-hover text-white px-4 py-2 text-sm font-semibold cursor-pointer">
              {labels.save}
            </button>
          </>
        )}
      </form>

      {/* 联网搜索配置 */}
      <form action={saveWebSearch} className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 space-y-3">
        <h3 className="text-sm font-bold text-neutral-800 dark:text-white">{labels.webSearchTitle}</h3>
        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-500">{labels.webSearchProvider}</label>
          <select
            name="provider"
            defaultValue={ws.provider ?? "tavily"}
            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-sora-blue cursor-pointer"
          >
            <option value="tavily">Tavily</option>
            <option value="bocha">Bocha(博查)</option>
            <option value="zhipu">智谱 BigModel</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-500">{labels.webSearchApiKey}</label>
          <input
            name="api_key"
            type="password"
            defaultValue={ws.api_key ?? ""}
            placeholder="sk-..."
            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:border-sora-blue"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-500">{labels.webSearchModel}</label>
          <input
            name="model"
            defaultValue={ws.model ?? ""}
            placeholder="glm-4-plus(仅智谱需要)"
            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:border-sora-blue"
          />
          <p className="text-[11px] text-neutral-400">{labels.webSearchHint}</p>
        </div>
        <button type="submit" className="rounded-md bg-sora-blue hover:bg-sora-blue-hover text-white px-4 py-2 text-sm font-semibold cursor-pointer">
          {labels.save}
        </button>
      </form>

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
