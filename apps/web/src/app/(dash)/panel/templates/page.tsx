/**
 * 用户模板页 —— /panel/templates
 *
 * 展示当前用户可见的模板(builtin + shared + 自己 private),按分类分组。
 * 支持快速跳转到 chat 使用(带 templateId query)。
 */
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session";
import { listTemplates } from "@/lib/templates/service";
import { FileText } from "lucide-react";
import { PageHeader } from "@/shared/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function PanelTemplatesPage() {
  const user = await requireSession();
  const tt = await getTranslations("panel.templates");
  const tn = await getTranslations("nav");
  const templates = await listTemplates({ userId: user.id });

  // 按分类分组
  const groups = new Map<string, typeof templates>();
  for (const t of templates) {
    const cat = t.category ?? tt("defaultCategory");
    const arr = groups.get(cat) ?? [];
    arr.push(t);
    groups.set(cat, arr);
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <PageHeader icon={FileText} title={tn("templates")} desc={tt("desc")} />

      {templates.length === 0 && (
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#12141a] p-10 text-center shadow-none">
          <p className="text-ui-body text-neutral-400">{tt("empty")}</p>
        </div>
      )}

      {Array.from(groups.entries()).map(([category, items]) => (
        <div key={category} className="space-y-3">
          <h2 className="text-ui-caption font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            {category}
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {items.map((t) => (
              <div
                key={t.id}
                className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-4 shadow-none hover:border-sora-blue/40 transition-colors duration-150"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-ui-title">{t.icon ?? "📄"}</span>
                    <div>
                      <div className="font-semibold text-ui-body text-neutral-900 dark:text-white flex items-center gap-1.5">
                        {t.name}
                        {t.isAgent && (
                          <span className="text-ui-caption px-1 py-0.5 rounded bg-sora-blue/10 text-sora-blue border border-sora-blue/20 font-medium">Agent</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className="text-ui-caption text-neutral-400 font-mono">{t.scope}</span>
                </div>
                {t.description && (
                  <p className="mt-2 text-ui-caption text-neutral-500 dark:text-neutral-400 leading-relaxed line-clamp-2">{t.description}</p>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-ui-caption text-neutral-400">
                    {t.variables.length > 0 ? tt("varCount", { count: t.variables.length }) : tt("noVars")}
                  </span>
                  <Link
                    href={`/chat?templateId=${t.id}`}
                    className="text-ui-caption font-medium text-sora-blue hover:underline"
                  >
                    {tt("use")}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
