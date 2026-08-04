import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getShare } from "@/features/chat/actions/share";
import { ReadonlyChatMessage } from "@/features/chat/components/ReadonlyChatMessage";
import { MessageTimeSeparator } from "@/features/chat/components/MessageTimeSeparator";
import { ShareUnlockForm } from "@/features/chat/components/ShareUnlockForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const share = await getShare(shareId);
  const t = await getTranslations("share");

  if (share.status !== "ready") {
    return (
      <main className="min-h-screen bg-nebula-white px-6 py-16 text-space-ink dark:bg-twilight-obsidian dark:text-nebula-silver">
        <div className="mx-auto flex min-h-[60vh] max-w-[75ch] items-center">
          {share.status === "locked" ? <ShareUnlockForm shareId={shareId} /> : <div className="space-y-3"><h1 className="text-ui-title font-semibold">{t("unavailableTitle")}</h1><p className="text-ui-body text-neutral-500 dark:text-neutral-400">{t("notFound")}</p><Link href="/" className="inline-flex text-ui-body font-medium text-sora-blue hover:underline">{t("back")}</Link></div>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-nebula-white px-5 py-8 text-space-ink transition-colors dark:bg-twilight-obsidian dark:text-nebula-silver sm:px-8 sm:py-12">
      {share.renderStyle?.css && <style dangerouslySetInnerHTML={{ __html: share.renderStyle.css }} />}
      <div className="mx-auto max-w-[75ch]">
        <header className="mb-10 border-b border-morning-mist pb-5 dark:border-deep-space">
          <div className="flex items-start justify-between gap-4"><div className="min-w-0"><h1 className="text-ui-subheading font-semibold text-space-ink dark:text-nebula-silver">{share.title}</h1></div><Link href="/" className="shrink-0 text-ui-caption font-medium text-sora-blue hover:underline">Nekusora</Link></div>
          <p className="mt-3 text-ui-caption text-neutral-500 dark:text-neutral-400">{t("readonly")}</p>
        </header>
        <section className="space-y-8" aria-label={t("conversation")}>
          {share.messages.map((message, index) => (
            <div key={`${index}-${message.role}`}>
              <MessageTimeSeparator
                createdAt={message.createdAt}
                previousCreatedAt={share.messages[index - 1]?.createdAt}
                isFirst={index === 0}
              />
              <ReadonlyChatMessage
                role={message.role}
                content={message.content}
                renderStyleClass={share.renderStyle?.cssClass}
                renderer={share.renderStyle?.renderer}
                runMetadata={message.runMetadata}
              />
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
