import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireSession } from "@/lib/session";
import {
  listKnowledgeBases,
  createKnowledgeBase,
  deleteKnowledgeBase,
  attachFileToKnowledgeBase,
} from "@/lib/knowledge-base/service";
import { Library, Trash2 } from "lucide-react";
import KnowledgeDebug from "./KnowledgeDebug";
import { PageHeader } from "@/shared/components/PageHeader";

export default async function KnowledgePage() {
  const user = await requireSession();
  const t = await getTranslations("panel.knowledge");
  const tn = await getTranslations("nav");
  const kbs = await listKnowledgeBases();

  // 列出用户可加入知识库的 ragReady 文件(未归属任何 KB)
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const freeFiles = await db
    .select({ id: s.fileObjects.id, filename: s.fileObjects.filename })
    .from(s.fileObjects)
    .where(eq(s.fileObjects.userId, user.id));

  async function handleCreate(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || undefined;
    if (!name) return;
    await createKnowledgeBase(name, description);
  }

  async function handleDelete(id: string) {
    "use server";
    await deleteKnowledgeBase(id);
  }

  async function handleAttach(formData: FormData) {
    "use server";
    const kbId = String(formData.get("kbId") ?? "");
    const fileId = String(formData.get("fileId") ?? "");
    if (!kbId || !fileId) return;
    await attachFileToKnowledgeBase(kbId, fileId);
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={Library} title={tn("knowledge")} desc={t("desc")} />

      {/* 新建知识库 */}
      <form action={handleCreate} className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0d0f14] p-4 space-y-3">
        <div className="text-ui-caption font-semibold uppercase tracking-wider text-neutral-400">{t("createTitle")}</div>
        <input
          name="name"
          placeholder={t("namePlaceholder")}
          required
          className="touch-target w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2 text-ui-body focus:outline-none focus:border-sora-blue"
        />
        <input
          name="description"
          placeholder={t("descPlaceholder")}
          className="touch-target w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2 text-ui-body focus:outline-none focus:border-sora-blue"
        />
        <button type="submit" className="touch-target rounded-md bg-sora-blue hover:bg-sora-blue-hover text-white px-4 py-2 text-ui-body font-semibold cursor-pointer">
          {t("createBtn")}
        </button>
      </form>

      {/* 知识库列表 */}
      <div className="space-y-3">
        {kbs.length === 0 ? (
          <p className="text-ui-caption text-neutral-400 py-8 text-center border border-dashed border-neutral-200 dark:border-neutral-800 rounded-lg">{t("empty")}</p>
        ) : (
          kbs.map((kb) => (
            <div key={kb.id} className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0d0f14] p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-ui-body text-neutral-900 dark:text-white">{kb.name}</div>
                  {kb.description && <div className="text-ui-caption text-neutral-500 mt-0.5">{kb.description}</div>}
                  <div className="text-ui-caption text-neutral-400 mt-1 font-mono">{kb.fileCount} {t("files")}</div>
                </div>
                <form action={handleDelete.bind(null, kb.id)}>
                  <button type="submit" className="touch-target inline-flex items-center justify-center p-1.5 rounded text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors cursor-pointer" aria-label={t("delete")}>
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </form>
              </div>
              {/* 加入文件 */}
              {freeFiles.length > 0 && (
                <form action={handleAttach} className="flex items-center gap-2">
                  <input type="hidden" name="kbId" value={kb.id} />
                  <select name="fileId" className="touch-target flex-1 rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-2 py-1.5 text-ui-caption focus:outline-none focus:border-sora-blue cursor-pointer">
                    <option value="">{t("selectFile")}</option>
                    {freeFiles.map((f: { id: string; filename: string }) => (
                      <option key={f.id} value={f.id}>{f.filename}</option>
                    ))}
                  </select>
                  <button type="submit" className="touch-target rounded-md border border-neutral-200 dark:border-neutral-800 px-3 py-1.5 text-ui-caption font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-900 cursor-pointer">
                    {t("attach")}
                  </button>
                </form>
              )}
            </div>
          ))
        )}
      </div>

      {/* 检索调试 */}
      <KnowledgeDebug kbIds={kbs.map((kb) => kb.id)} />
    </div>
  );
}
