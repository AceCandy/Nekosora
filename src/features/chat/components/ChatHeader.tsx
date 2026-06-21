"use client";

import { useState, useTransition } from "react";
import { Share2, Check } from "lucide-react";

export default function ChatHeader({
  conversationId,
  messageCount,
  createShareAction,
}: {
  conversationId: string;
  messageCount: number;
  createShareAction: (id: string) => Promise<string>;
}) {
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const handleShare = () => {
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
    <div className="flex items-center justify-between px-6 py-3.5 border-b border-neutral-200 dark:border-neutral-800 bg-[#fcfdff] dark:bg-[#0d0f14]">
      <span className="text-xs font-mono text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
        {messageCount} 条对话记录
      </span>
      <button
        onClick={handleShare}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors px-2.5 py-1.5 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-900/50"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-500" />
            <span className="text-green-600 dark:text-green-500">已复制分享链接</span>
          </>
        ) : (
          <>
            <Share2 className="w-3.5 h-3.5" />
            <span>分享此对话</span>
          </>
        )}
      </button>
    </div>
  );
}
