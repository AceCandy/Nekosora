/**
 * 模板管理页(管理员)—— /admin/templates
 *
 * 查看全部模板(builtin/shared/private),支持启用/禁用、删除用户模板。
 * builtin 模板只读(由 seed-templates 脚本维护)。
 */
import { desc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminTemplatesPage() {
  await requireAdmin();
  const t = await getTranslations("admin.templates");
  const tn = await getTranslations("nav");
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const templates = await db
    .select()
    .from(s.promptTemplates)
    .orderBy(desc(s.promptTemplates.createdAt));

  return (
    <div className="space-y-8 max-w-5xl">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">{tn("globalTemplates")}</h1>

      <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] overflow-hidden shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-neutral-50/70 border-b border-neutral-200 text-neutral-500 dark:bg-neutral-900/50 dark:border-neutral-800 dark:text-neutral-400 text-xs uppercase tracking-wider font-semibold">
                <th className="text-left px-5 py-3">{t("thName")}</th>
                <th className="text-left px-5 py-3">{t("thCategory")}</th>
                <th className="text-left px-5 py-3">{t("thScope")}</th>
                <th className="text-center px-5 py-3">Agent</th>
                <th className="text-right px-5 py-3">{t("thUseCount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {templates.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-neutral-400 dark:text-neutral-500">
                    {t("empty")}
                  </td>
                </tr>
              )}
              {templates.map((tpl: Record<string, unknown>) => (
                <tr key={tpl.id as string} className="hover:bg-neutral-50/30 dark:hover:bg-neutral-900/10 transition-colors duration-150">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{(tpl.icon as string) ?? "📄"}</span>
                      <div>
                        <div className="font-medium text-neutral-900 dark:text-white text-sm">{tpl.name as string}</div>
                        {(tpl.description as string) && (
                          <div className="text-[11px] text-neutral-400 dark:text-neutral-500 truncate max-w-[280px]">{tpl.description as string}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-neutral-500 font-mono">{(tpl.category as string) ?? "-"}</td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 border border-neutral-200/50 dark:border-neutral-700/50">
                      {tpl.scope as string}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    {tpl.isAgent ? (
                      <span className="text-sora-blue text-xs">🤖</span>
                    ) : (
                      <span className="text-neutral-300 dark:text-neutral-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono text-xs text-neutral-500">
                    {Number(tpl.useCount ?? 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
