import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getAuth } from "@/auth";
import {
  listConversations,
  togglePinnedConversation,
  toggleArchivedConversation,
  deleteConversation,
} from "@/features/chat/actions/conversations";
import Sidebar from "@/features/chat/components/Sidebar";

/**
 * 图像工作区共享 layout —— 复用 chat 侧栏(保持导航一致)。
 */
export default async function ImageLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();
  const t = await getTranslations("chat");
  const tc = await getTranslations("nav");
  const conversations = await listConversations();

  async function handleSignOut() {
    "use server";
    const auth = await getAuth();
    await auth.api.signOut({ headers: await headers() });
    redirect("/login");
  }
  async function handleTogglePinned(id: string) {
    "use server";
    await togglePinnedConversation(id);
  }
  async function handleToggleArchived(id: string) {
    "use server";
    await toggleArchivedConversation(id);
  }
  async function handleDelete(id: string) {
    "use server";
    await deleteConversation(id);
  }

  const mappedConversations = conversations.map((c: Record<string, unknown>) => ({
    id: c.id as string,
    title: c.title as string,
    pinned: (c.pinned as boolean) ?? false,
    archived: (c.archived as boolean) ?? false,
    updatedAt: c.updatedAt instanceof Date ? c.updatedAt.getTime() : Number(c.updatedAt ?? 0),
  }));

  return (
    <div className="flex h-screen overflow-hidden bg-nebula-white text-space-ink dark:bg-twilight-obsidian dark:text-nebula-silver transition-colors duration-200">
      <Sidebar
        userEmail={user.email}
        conversations={mappedConversations}
        newConversationText={t("newConversation")}
        conversationsText={t("conversations")}
        noConversationsText={t("noConversations")}
        panelText={tc("panel")}
        logoutText={tc("logout")}
        groupPinnedText={t("groupPinned")}
        groupTodayText={t("groupToday")}
        groupYesterdayText={t("groupYesterday")}
        groupEarlierText={t("groupEarlier")}
        groupArchivedText={t("groupArchived")}
        searchText={t("searchConversations")}
        imageText={tc("image")}
        actionPinText={t("actionPin")}
        actionUnpinText={t("actionUnpin")}
        actionArchiveText={t("actionArchive")}
        actionUnarchiveText={t("actionUnarchive")}
        actionDeleteText={t("actionDelete")}
        deleteConfirmText={t("deleteConfirm")}
        signOutAction={handleSignOut}
        togglePinnedAction={handleTogglePinned}
        toggleArchivedAction={handleToggleArchived}
        deleteAction={handleDelete}
      />
      <main className="flex-1 flex flex-col min-w-0">{children}</main>
    </div>
  );
}
