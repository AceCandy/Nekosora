"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Share2 } from "lucide-react";
import type { ConversationShareListItem, CreateShareInput } from "@/features/chat/actions/share";
import ShareDialog from "@/features/chat/components/ShareDialog";

interface ChatHeaderProps {
  title: string;
  /** 当前会话 id;新会话(未建会)为 undefined,分享按钮禁用。 */
  conversationId?: string;
  /** 点击时可完整快照的当前可见消息 ID;空数组表示暂不可分享。 */
  canShare: boolean;
  createShareAction: (input: CreateShareInput) => Promise<ConversationShareListItem>;
  listSharesAction: (conversationId: string) => Promise<ConversationShareListItem[]>;
  revokeShareAction: (shareId: string) => Promise<void>;
}

export default function ChatHeader({
  title,
  conversationId,
  canShare,
  createShareAction,
  listSharesAction,
  revokeShareAction,
}: ChatHeaderProps) {
  const t = useTranslations("chat");
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between bg-nebula-white pl-14 pr-4 dark:bg-twilight-obsidian md:px-6">
      <h1 className="min-w-0 truncate text-ui-reading font-semibold text-space-ink dark:text-nebula-silver" title={title}>
        {title}
      </h1>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        disabled={!conversationId}
        className="touch-target ml-4 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-space-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-nebula-silver"
        aria-label={t("shareThisConversation")}
        title={t("shareThisConversation")}
      >
        <Share2 className="h-5 w-5" aria-hidden="true" />
      </button>
      {conversationId && dialogOpen && <ShareDialog open onClose={() => setDialogOpen(false)} conversationId={conversationId} canShare={canShare} createShareAction={createShareAction} listSharesAction={listSharesAction} revokeShareAction={revokeShareAction} />}
    </header>
  );
}
