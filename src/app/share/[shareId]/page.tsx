import { getShare } from "@/features/chat/actions/share";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function SharePage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const share = await getShare(shareId);
  if (!share) notFound();
  const t = await getTranslations("share");

  return (
    <main className="relative min-h-screen bg-[#fcfdff] text-[#0f121a] dark:bg-[#0d0f14] dark:text-[#f1f3f7] p-6 sm:p-12 transition-colors duration-200 overflow-hidden">
      {/* 天空冷调柔光背景 */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(59,130,246,0.03),transparent_40%)] dark:bg-[radial-gradient(circle_at_50%_10%,rgba(59,130,246,0.05),transparent_40%)]" />

      <div className="relative z-10 max-w-[75ch] mx-auto space-y-10">
        {/* 顶部优雅 Header */}
        <div className="rounded-lg border border-neutral-200/80 bg-white/40 p-5 backdrop-blur-sm dark:border-neutral-800/80 dark:bg-[#12141a]/40 shadow-none space-y-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono tracking-wider uppercase font-semibold">
              {t("snapshot")}
            </span>
            <Link
              href="/"
              className="text-xs text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 font-medium transition-colors"
            >
              {t("learnMore")}
            </Link>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white leading-tight">
              {share.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {share.model && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400 border border-blue-500/10 font-mono">
                  {share.model}
                </span>
              )}
              <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
                {t("readonly")}
              </span>
            </div>
          </div>
        </div>

        {/* 消息历史（符合大呼吸感和 max-w-[75ch] 的排版） */}
        <div className="space-y-8">
          {share.messages.map((m, i) => {
            const isUser = m.role === "user";
            return (
              <div key={i} className={`flex flex-col ${isUser ? "items-end" : "items-start"} space-y-1`}>
                <div className="text-[10px] font-semibold text-neutral-400 dark:text-neutral-500 px-1 uppercase tracking-wider">
                  {isUser ? t("user") : t("assistant")}
                </div>
                <div
                  className={
                    isUser
                      ? "rounded-2xl rounded-tr-sm bg-neutral-900 text-white dark:bg-white dark:text-black px-4 py-2.5 max-w-[85%] text-sm shadow-none leading-relaxed break-words whitespace-pre-wrap"
                      : "w-full text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed whitespace-pre-wrap break-words border-l-2 border-neutral-100 dark:border-neutral-800 pl-4 py-1"
                  }
                >
                  {m.content}
                </div>
              </div>
            );
          })}
        </div>

        {/* 底部版权或指引 */}
        <div className="text-center pt-8 border-t border-neutral-200/50 dark:border-neutral-800/50 text-[11px] text-neutral-400 dark:text-neutral-500">
          {t("generatedFrom")} <span className="font-semibold text-neutral-600 dark:text-neutral-400">Nekusora</span> {t("workbench")}
        </div>
      </div>
    </main>
  );
}
