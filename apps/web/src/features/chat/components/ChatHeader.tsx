"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import { Share2 } from "lucide-react";
import type { ConversationShareListItem, CreateShareInput } from "@/features/chat/actions/share";
import ShareDialog from "@/features/chat/components/ShareDialog";

interface ChatHeaderProps {
  title: string;
  /** 会话标题后的输出样式入口。 */
  renderStyleMenu?: ReactNode;
  /** 当前会话 id;新会话(未建会)为 undefined,不显示分享按钮。 */
  conversationId?: string;
  /** 点击时可完整快照的当前可见消息 ID;空数组表示暂不可分享。 */
  canShare: boolean;
  /** 空会话欢迎态时头部透明,让 SkyAtmosphere 天幕连续延伸到视口顶部(无消息滚动,无需不透明底)。 */
  transparent?: boolean;
  createShareAction: (input: CreateShareInput) => Promise<ConversationShareListItem>;
  listSharesAction: (conversationId: string) => Promise<ConversationShareListItem[]>;
  revokeShareAction: (shareId: string) => Promise<void>;
}

export default function ChatHeader({
  title,
  renderStyleMenu,
  conversationId,
  canShare,
  transparent = false,
  createShareAction,
  listSharesAction,
  revokeShareAction,
}: ChatHeaderProps) {
  const t = useTranslations("chat");
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <header className={clsx(
      "flex h-14 shrink-0 items-center pl-14 pr-4 transition-colors duration-300 md:px-6",
      transparent ? "bg-transparent" : "bg-nebula-white",
    )}>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <h1 className="min-w-0 truncate text-ui-reading font-semibold text-space-ink " title={title}>
          {title}
        </h1>
        {renderStyleMenu}
      </div>
      {conversationId && (
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="touch-target ml-4 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-space-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue motion-reduce:transition-none   "
          aria-label={t("shareThisConversation")}
          title={t("shareThisConversation")}
        >
          <Share2 className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      {conversationId && dialogOpen && <ShareDialog open onClose={() => setDialogOpen(false)} conversationId={conversationId} canShare={canShare} createShareAction={createShareAction} listSharesAction={listSharesAction} revokeShareAction={revokeShareAction} />}
    </header>
  );
}
