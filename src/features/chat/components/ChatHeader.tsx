"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Share2, Check } from "lucide-react";

export default function ChatHeader({
  title,
  conversationId,
  createShareAction,
}: {
  title: string;
  /** 当前会话 id;新会话(未建会)为 undefined,分享按钮禁用。 */
  conversationId?: string;
  createShareAction: (id: string) => Promise<string>;
}) {
  const t = useTranslations("chat");
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const handleShare = () => {
    if (!conversationId) return;
    startTransition(async () => {
      try {
        const shareId = await createShareAction(conversationId);
        const shareUrl = `${window.location.origin}/share/${shareId}`;
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error(err);
      }
    });
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between bg-nebula-white pl-14 pr-4 dark:bg-twilight-obsidian md:px-6">
      <h1 className="min-w-0 truncate text-ui-reading font-semibold text-space-ink dark:text-nebula-silver" title={title}>
        {title}
      </h1>
      <button
        type="button"
        onClick={handleShare}
        disabled={isPending || !conversationId}
        className="touch-target ml-4 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-space-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-nebula-silver"
        aria-label={copied ? t("shareCopied") : t("shareThisConversation")}
        title={copied ? t("shareCopied") : t("shareThisConversation")}
      >
        {copied ? (
          <Check className="h-5 w-5 text-green-600 dark:text-green-500" aria-hidden="true" />
        ) : (
          <Share2 className="h-5 w-5" aria-hidden="true" />
        )}
      </button>
    </header>
  );
}
