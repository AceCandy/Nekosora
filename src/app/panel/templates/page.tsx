/**
 * 用户模板页 —— /panel/templates
 *
 * 展示当前用户可见的模板(builtin + shared + 自己 private),按分类分组。
 * 支持快速跳转到 chat 使用(带 templateId query)。
 */
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { listTemplates } from "@/lib/templates/service";

export const dynamic = "force-dynamic";

export default async function PanelTemplatesPage() {
  const user = await requireSession();
  const templates = await listTemplates({ userId: user.id });

  // 按分类分组
  const groups = new Map<string, typeof templates>();
  for (const t of templates) {
    const cat = t.category ?? "其他";
    const arr = groups.get(cat) ?? [];
    arr.push(t);
    groups.set(cat, arr);
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">Prompt 模板</h1>
        <p className="mt-1 text-sm text-neutral-500">
          可复用的提示词模板与 Agent。选择模板后可在 Chat 中填入变量快速启动对话。
        </p>
      </div>

      {templates.length === 0 && (
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#12141a] p-10 text-center shadow-none">
          <p className="text-sm text-neutral-400">暂无可用模板</p>
        </div>
      )}

      {Array.from(groups.entries()).map(([category, items]) => (
        <div key={category} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
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
                    <span className="text-lg">{t.icon ?? "📄"}</span>
                    <div>
                      <div className="font-semibold text-sm text-neutral-900 dark:text-white flex items-center gap-1.5">
                        {t.name}
                        {t.isAgent && (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-sora-blue/10 text-sora-blue border border-sora-blue/20 font-medium">Agent</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] text-neutral-400 font-mono">{t.scope}</span>
                </div>
                {t.description && (
                  <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed line-clamp-2">{t.description}</p>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[10px] text-neutral-400">
                    {t.variables.length > 0 ? `${t.variables.length} 个变量` : "无变量"}
                  </span>
                  <Link
                    href={`/chat?templateId=${t.id}`}
                    className="text-xs font-medium text-sora-blue hover:underline"
                  >
                    使用 →
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
