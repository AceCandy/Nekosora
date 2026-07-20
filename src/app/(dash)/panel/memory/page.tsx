import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import {
  getMemories,
  addMemory,
  deleteMemory,
  updateMemory,
  clearMemories,
  type MemoryScope,
  type UserMemory,
} from "@/lib/memory/service";
import { requireSession } from "@/lib/session";
import { Trash2, Plus, BrainCircuit, Eraser } from "lucide-react";
import { clsx } from "clsx";
import { PageHeader } from "@/shared/components/PageHeader";

const SCOPE_ORDER: MemoryScope[] = ["preference", "profile", "project"];

/** 记忆时间格式化为「YYYY-MM-DD HH:mm」,无效值回退「—」。 */
function formatDate(d?: Date | null): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export default async function MemoryPage() {
  const user = await requireSession();
  const t = await getTranslations("panel.memory");
  const tn = await getTranslations("nav");
  const memories = await getMemories(user.id);

  // 按 scope 分组,组内按创建时间倒序(新的在前)
  const grouped = new Map<MemoryScope, UserMemory[]>();
  for (const scope of SCOPE_ORDER) grouped.set(scope, []);
  for (const m of memories) {
    const arr = grouped.get(m.scope as MemoryScope);
    if (arr) arr.push(m);
  }
  for (const arr of grouped.values()) {
    arr.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  }

  const scopeLabel = (scope: MemoryScope) =>
    scope === "preference" ? t("scopePreference") : scope === "profile" ? t("scopeProfile") : t("scopeProject");

  // 编辑记忆的 server action(从 formData 取 content)。补 revalidatePath 触发 RSC 重渲染。
  async function handleUpdateMemory(memoryId: string, formData: FormData) {
    "use server";
    const content = String(formData.get("content") ?? "").trim();
    if (!content) return;
    await updateMemory(user.id, memoryId, content);
    revalidatePath("/panel", "layout");
  }

  return (
    <div className="space-y-6">
      {/* 标题 + 全部清空 */}
      <div className="flex items-start justify-between gap-4">
        <PageHeader icon={BrainCircuit} title={tn("memory")} desc={t("desc")} />
        {memories.length > 0 && (
          <form
            action={async () => {
              "use server";
              await clearMemories(user.id);
              revalidatePath("/panel", "layout");
            }}
            className="shrink-0"
          >
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/10 px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/20 transition-colors"
              title={t("clearAll")}
            >
              <Eraser className="w-3.5 h-3.5" />
              <span>{t("clearAll")}</span>
            </button>
          </form>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* 左:按分类分组的记忆卡片 */}
        <div className="lg:col-span-2 space-y-8">
          {memories.length === 0 && (
            <div className="rounded-lg border border-dashed border-neutral-200 dark:border-neutral-800 p-10 text-center text-xs text-neutral-400 dark:text-neutral-500">
              {t("empty")}
            </div>
          )}

          {SCOPE_ORDER.map((scope) => {
            const items = grouped.get(scope) ?? [];
            if (items.length === 0) return null;
            return (
              <section key={scope} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                    {scopeLabel(scope)}
                    <span className="ml-2 text-neutral-300 dark:text-neutral-600 font-normal normal-case">
                      {t("scopeCount", { count: items.length })}
                    </span>
                  </h2>
                  <form
                    action={async () => {
                      "use server";
                      await clearMemories(user.id, scope);
                      revalidatePath("/panel", "layout");
                    }}
                  >
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 text-[11px] text-neutral-400 hover:text-red-500 transition-colors"
                      title={t("clearScope")}
                    >
                      <Eraser className="w-3 h-3" />
                      <span>{t("clearScope")}</span>
                    </button>
                  </form>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  {items.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0d0f14] p-4 flex flex-col gap-2 transition-colors duration-150"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={clsx(
                              "rounded-full px-1.5 py-0.5 text-[9px] font-medium border",
                              m.source === "ai"
                                ? "bg-sora-blue/[0.03] border-sora-blue/20 text-sora-blue"
                                : "bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-neutral-400",
                            )}
                            title={m.source === "ai" ? t("sourceAi") : t("sourceManual")}
                          >
                            {m.source === "ai" ? "AI" : t("sourceManual")}
                          </span>
                        </div>
                        <form
                          action={async () => {
                            "use server";
                            await deleteMemory(user.id, m.id);
                            revalidatePath("/panel", "layout");
                          }}
                        >
                          <button
                            type="submit"
                            className="inline-flex items-center justify-center p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                            title={t("deleteTitle")}
                          >
                            <Trash2 size={14} />
                          </button>
                        </form>
                      </div>

                      <details>
                        <summary className="cursor-pointer list-none text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed break-words">
                          {m.content}
                        </summary>
                        <form action={handleUpdateMemory.bind(null, m.id)} className="mt-2 space-y-2">
                          <textarea
                            name="content"
                            defaultValue={m.content}
                            rows={3}
                            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-2 py-1.5 text-xs focus:outline-none focus:border-sora-blue resize-none"
                          />
                          <button
                            type="submit"
                            className="rounded-md bg-sora-blue hover:bg-sora-blue-hover text-white px-3 py-1 text-xs font-semibold cursor-pointer"
                          >
                            {t("save")}
                          </button>
                        </form>
                      </details>

                      <div className="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono pt-1 mt-auto border-t border-neutral-100 dark:border-neutral-800/60">
                        {t("createdAt")}: {formatDate(m.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {/* 右:添加新记忆表单 */}
        <div className="lg:col-span-1 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0d0f14] p-5 space-y-4">
          <div className="border-b border-neutral-100 dark:border-neutral-800/80 pb-3">
            <h3 className="text-sm font-bold text-neutral-800 dark:text-white flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-blue-500" />
              <span>{t("addTitle")}</span>
            </h3>
          </div>

          <form
            action={async (formData: FormData) => {
              "use server";
              await addMemory(
                user.id,
                formData.get("scope") as "preference" | "profile" | "project",
                String(formData.get("content") ?? ""),
              );
              revalidatePath("/panel", "layout");
            }}
            className="space-y-4"
          >
            <label className="block">
              <span className="block text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1">
                {t("scopeLabel")}
              </span>
              <select
                name="scope"
                className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0f121a] px-3.5 py-2 text-sm focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 text-neutral-800 dark:text-neutral-200 transition-all duration-150"
              >
                <option value="preference">{t("scopePreferenceOpt")}</option>
                <option value="profile">{t("scopeProfileOpt")}</option>
                <option value="project">{t("scopeProjectOpt")}</option>
              </select>
            </label>

            <label className="block">
              <span className="block text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1">
                {t("contentLabel")}
              </span>
              <textarea
                name="content"
                required
                placeholder={t("contentPlaceholder")}
                rows={4}
                className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0f121a] px-3.5 py-2 text-sm focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 text-neutral-800 dark:text-neutral-200 transition-all duration-150 resize-none"
              />
            </label>

            <button
              type="submit"
              className="w-full rounded-md bg-neutral-900 dark:bg-white dark:text-black font-semibold text-white hover:bg-neutral-800 dark:hover:bg-neutral-100 py-2.5 text-xs transition-colors shadow-none flex items-center justify-center gap-1"
            >
              <Plus className="w-4 h-4" />
              <span>{t("addBtn")}</span>
            </button>
          </form>

          <div className="rounded p-3 bg-neutral-50 dark:bg-neutral-900/30 text-[10px] text-neutral-400 dark:text-neutral-500 leading-normal space-y-1">
            <p className="font-semibold text-neutral-500 dark:text-neutral-400">{t("guideTitle")}</p>
            <p>{t("guide1")}</p>
            <p>{t("guide2")}</p>
            <p>{t("guide3")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
