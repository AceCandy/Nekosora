import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listConversations, getVisibleModels } from "@/features/chat/actions/conversations";
import { listMyCards } from "@/features/panel/cards/actions";
import ChatComposer, { type ModelOption } from "@/features/chat/components/ChatComposer";
import { MessageSquare } from "lucide-react";

export default async function ChatPage() {
  const t = await getTranslations("chat");
  const [conversations, { globals, byos }, cards] = await Promise.all([
    listConversations(),
    getVisibleModels(),
    listMyCards(),
  ]);
  const models: ModelOption[] = [
    ...globals.map((m: Record<string, unknown>) => ({
      name: m.name as string,
      displayName: (m.displayName as string | undefined) ?? undefined,
    })),
    // BYO 模型表无 displayName,UI 回退到 name
    ...byos.map((r: Record<string, unknown>) => ({
      name: (r.model as Record<string, unknown>).name as string,
    })),
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-[#fcfdff] dark:bg-[#0d0f14] transition-colors duration-200">
      {/* Mid Sidebar: Conversation History list */}
      <div className="w-60 border-r border-morning-mist dark:border-deep-space overflow-y-auto shrink-0 bg-neutral-50/30 dark:bg-[#0c0d12]">
        <div className="p-3 space-y-1">
          <div className="px-3 py-1.5 text-xs font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
            {t("conversations")}
          </div>
          {conversations.length === 0 ? (
            <p className="text-xs text-neutral-400 px-3 py-4">{t("noConversations")}</p>
          ) : (
            conversations.map((c: Record<string, unknown>) => (
              <Link
                key={c.id as string}
                href={`/chat/${c.id as string}`}
                className="inline-flex w-full items-center gap-2 truncate rounded-md px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-all duration-150"
              >
                <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
                <span className="truncate">{c.title as string}</span>
              </Link>
            ))
          )}
        </div>
      </div>
      
      {/* Right Content Area: Chat Composer */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <ChatComposer models={models} cards={cards} />
      </div>
    </div>
  );
}

