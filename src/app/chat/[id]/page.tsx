import Link from "next/link";
import { listConversations, getVisibleModels, getMessages, getArtifactsByConversation } from "../actions";
import { createShare } from "../share-actions";
import ChatComposer from "../ChatComposer";
import ChatHeader from "./ChatHeader";
import { MessageSquare } from "lucide-react";

export default async function ChatConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [conversations, { globals, byos }, msgs, artifactsMap] = await Promise.all([
    listConversations(),
    getVisibleModels(),
    getMessages(id).catch(() => []),
    getArtifactsByConversation(id).catch(() => ({})),
  ]);
  const models = [
    ...globals.map((m: Record<string, unknown>) => m.name as string),
    ...byos.map((r: Record<string, unknown>) => (r.model as Record<string, unknown>).name as string),
  ];

  // Convert messages to ChatComposer format(P1-B:关联 artifacts)
  const artifactsByMsg = artifactsMap as Record<string, { id: string; kind: string; title: string; language: string | null; content: string }[]>;
  const initialMessages = (msgs as Record<string, unknown>[]).map((m) => ({
    role: m.role as "user" | "assistant",
    content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
    artifacts: (artifactsByMsg[m.id as string] ?? []) as
      | { id: string; kind: "code" | "mermaid" | "svg" | "html" | "katex" | "markdown"; title: string; language: string | null; content: string }[]
      | undefined,
  }));

  // Server action wrapper for sharing
  async function handleCreateShare(convId: string) {
    "use server";
    return createShare(convId);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#fcfdff] dark:bg-[#0d0f14] transition-colors duration-200">
      {/* Mid Sidebar: Conversation History list */}
      <div className="w-60 border-r border-neutral-200 dark:border-neutral-800 overflow-y-auto shrink-0 bg-neutral-50/30 dark:bg-[#0c0d12]">
        <div className="p-3 space-y-1">
          <div className="px-3 py-1.5 text-xs font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
            会话历史
          </div>
          {conversations.map((c: Record<string, unknown>) => {
            const isCurrent = c.id === id;
            return (
              <Link
                key={c.id as string}
                href={`/chat/${c.id as string}`}
                className={`inline-flex w-full items-center gap-2 truncate rounded-md px-3 py-2 text-xs font-medium transition-all duration-150 ${
                  isCurrent
                    ? "bg-blue-50 text-blue-600 dark:bg-blue-950/20 dark:text-blue-400 font-semibold"
                    : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                }`}
              >
                <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isCurrent ? "text-blue-500 opacity-100" : "opacity-60"}`} />
                <span className="truncate">{c.title as string}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Right Content Area: Chat Composer with Header */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <ChatHeader
          conversationId={id}
          messageCount={initialMessages.length}
          createShareAction={handleCreateShare}
        />
        <div className="flex-1 min-h-0">
          <ChatComposer
            models={models}
            conversationId={id}
            initialMessages={initialMessages}
          />
        </div>
      </div>
    </div>
  );
}

