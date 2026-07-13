"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Share2, Check, Coins } from "lucide-react";

export default function ChatHeader({
  conversationId,
  messageCount,
  totalTokens,
  createShareAction,
}: {
  /** 当前会话 id;新会话(未建会)为 undefined,分享按钮禁用。 */
  conversationId?: string;
  messageCount: number;
  /** 本会话累计发送 token(从各 assistant 消息的 trace 聚合)。 */
  totalTokens?: number;
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
    <div className="flex items-center justify-between pl-14 pr-6 md:px-6 py-3.5 border-b border-morning-mist dark:border-deep-space bg-nebula-white dark:bg-twilight-obsidian">
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
          {t("messageCount", { count: messageCount })}
        </span>
        {totalTokens != null && totalTokens > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-450 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-900 px-2 py-0.5 rounded-full">
            <Coins className="w-3 h-3" aria-hidden="true" />
            {t("totalTokens", { count: totalTokens })}
          </span>
        )}
      </div>
      <button
        onClick={handleShare}
        disabled={isPending || !conversationId}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-sora-blue hover:text-sora-blue-hover transition-colors px-2.5 py-1.5 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
        aria-label={t("shareThisConversation")}
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-500" aria-hidden="true" />
            <span className="text-green-600 dark:text-green-500">{t("shareCopied")}</span>
          </>
        ) : (
          <>
            <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t("shareThisConversation")}</span>
          </>
        )}
      </button>
    </div>
  );
}

