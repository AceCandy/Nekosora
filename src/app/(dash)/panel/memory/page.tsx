import { getTranslations } from "next-intl/server";
import { getMemories, addMemory, deleteMemory, updateMemory } from "@/lib/memory/service";
import { getMemoryDiagnostics } from "@/lib/memory/recall";
import { requireSession } from "@/lib/session";
import { Trash2, Plus, BrainCircuit, AlertTriangle } from "lucide-react";
import { clsx } from "clsx";

export default async function MemoryPage() {
  const user = await requireSession();
  const t = await getTranslations("panel.memory");
  const tn = await getTranslations("nav");
  const memories = await getMemories(user.id);
  const diagnostics = await getMemoryDiagnostics(user.id).catch(() => ({
    duplicateIds: new Set<string>(),
    staleIds: new Set<string>(),
  }));

  // 编辑记忆的 server action(从 formData 取 content)
  async function handleUpdateMemory(memoryId: string, formData: FormData) {
    "use server";
    const content = String(formData.get("content") ?? "").trim();
    if (!content) return;
    await updateMemory(user.id, memoryId, content);
  }

  // 删除记忆的 server action:deleteMemory 是 service 层普通函数(非 "use server"),
  // 不能直接 .bind 传给 <form action>,需在此内联包装,与 handleUpdateMemory 同模式。
  async function handleDeleteMemory(memoryId: string) {
    "use server";
    await deleteMemory(user.id, memoryId);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold mb-1 flex items-center gap-2">
          <BrainCircuit className="w-5 h-5 text-blue-500" />
          <span>{tn("memory")}</span>
        </h1>
        <p className="text-sm text-neutral-500">
          {t("desc")}
        </p>
      </div>

      {(diagnostics.duplicateIds.size > 0 || diagnostics.staleIds.size > 0) && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/10 p-4 max-w-3xl">
          <h3 className="text-sm font-bold text-neutral-800 dark:text-white flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span>{t("healthTitle")}</span>
          </h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            {t("healthDesc")}
          </p>
          <div className="flex flex-wrap gap-4 mt-2 text-xs">
            {diagnostics.duplicateIds.size > 0 && (
              <span className="text-amber-700 dark:text-amber-400">
                {t("healthDuplicate", { count: diagnostics.duplicateIds.size })}
              </span>
            )}
            {diagnostics.staleIds.size > 0 && (
              <span className="text-neutral-500 dark:text-neutral-400">
                {t("healthStale", { count: diagnostics.staleIds.size })}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-10 gap-8 items-start">
        {/* Left Table (6 lg cols) */}
        <div className="lg:col-span-6 space-y-4">
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0d0f14] overflow-hidden transition-colors duration-150">
            <table className="w-full text-sm text-left">
              <thead className="bg-neutral-50/70 dark:bg-neutral-900/50 border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 font-mono text-xs uppercase">
                <tr>
                  <th className="p-3.5 font-medium">{t("colScope")}</th>
                  <th className="p-3.5 font-medium">{t("colDetail")}</th>
                  <th className="p-3.5 font-medium text-right">{t("colActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/60">
                {memories.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-10 text-center text-xs text-neutral-400 dark:text-neutral-500">
                      {t("empty")}
                    </td>
                  </tr>
                )}
                {memories.map((m) => (
                  <tr
                    key={m.id}
                    className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/10 transition-colors"
                  >
                    <td className="p-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={clsx(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold border uppercase tracking-wider",
                            m.scope === "preference"
                              ? "bg-blue-500/[0.03] border-blue-500/20 text-blue-600 dark:text-blue-400"
                              : m.scope === "profile"
                              ? "bg-amber-500/[0.03] border-amber-500/20 text-amber-600 dark:text-amber-400"
                              : "bg-neutral-100 dark:bg-neutral-800 border-neutral-250 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400"
                          )}
                        >
                          {m.scope === "preference" ? t("scopePreference") : m.scope === "profile" ? t("scopeProfile") : t("scopeProject")}
                        </span>
                        <span
                          className={clsx(
                            "rounded-full px-1.5 py-0.5 text-[9px] font-medium border",
                            m.source === "ai"
                              ? "bg-sora-blue/[0.03] border-sora-blue/20 text-sora-blue"
                              : "bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-neutral-400"
                          )}
                          title={m.source === "ai" ? t("sourceAi") : t("sourceManual")}
                        >
                          {m.source === "ai" ? "AI" : t("sourceManual")}
                        </span>
                        {diagnostics.duplicateIds.has(m.id) && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[9px] font-medium border bg-amber-500/[0.03] border-amber-500/20 text-amber-600 dark:text-amber-400"
                            title={t("healthDuplicateHint")}
                          >
                            {t("healthDuplicateBadge")}
                          </span>
                        )}
                        {diagnostics.staleIds.has(m.id) && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[9px] font-medium border bg-neutral-100 dark:bg-neutral-800 border-neutral-250 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400"
                            title={t("healthStaleHint")}
                          >
                            {t("healthStaleBadge")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5 text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed max-w-[250px] break-words">
                      <details>
                        <summary className="cursor-pointer list-none">{m.content}</summary>
                        <form action={handleUpdateMemory.bind(null, m.id)} className="mt-2 space-y-2">
                          <textarea
                            name="content"
                            defaultValue={m.content}
                            rows={3}
                            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-2 py-1.5 text-xs focus:outline-none focus:border-sora-blue resize-none"
                          />
                          <button type="submit" className="rounded-md bg-sora-blue hover:bg-sora-blue-hover text-white px-3 py-1 text-xs font-semibold cursor-pointer">
                            {t("save")}
                          </button>
                        </form>
                      </details>
                    </td>
                    <td className="p-3.5 text-right">
                      <form action={handleDeleteMemory.bind(null, m.id)} className="inline">
                        <button
                          type="submit"
                          className="inline-flex items-center justify-center p-2 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                          title={t("deleteTitle")}
                        >
                          <Trash2 size={15} />
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Form (4 lg cols) */}
        <div className="lg:col-span-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0d0f14] p-5 space-y-4">
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

