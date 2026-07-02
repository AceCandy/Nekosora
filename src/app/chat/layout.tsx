import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getAuth } from "@/auth";
import { listConversations, togglePinnedConversation, toggleArchivedConversation, deleteConversation, getGeneratingStatuses } from "@/features/chat/actions/conversations";
import { listEnabledRenderStyles } from "@/lib/render-styles/service";
import Sidebar from "@/features/chat/components/Sidebar";

/**
 * Chat 共享 layout。
 *
 * 将历史会话列表及控制面板按钮上移，整体侧栏抽离成 Client Component (Sidebar.tsx)
 * 以支持移动端响应式折叠抽屉，避免挤压聊天区呼吸感。
 */
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();
  const t = await getTranslations("chat");
  const tc = await getTranslations("nav");
  const conversations = await listConversations();
  // 聚合所有启用输出样式的 CSS,注入聊天页;切换样式时只需改容器 class,无需刷新
  const renderStyles = await listEnabledRenderStyles().catch(() => []);
  const aggregatedStyleCss = (renderStyles as { css: string }[]).map((s) => s.css).join("\n");

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

  // 会话项映射为 Sidebar 所需结构(含置顶/归档/生成中标记/更新时间)
  const mappedConversations = conversations.map((c: Record<string, unknown>) => ({
    id: c.id as string,
    title: c.title as string,
    pinned: (c.pinned as boolean) ?? false,
    archived: (c.archived as boolean) ?? false,
    generating: (c.generating as boolean) ?? false,
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
        getGeneratingStatusesAction={getGeneratingStatuses}
      />
      <main className="flex-1 flex flex-col min-w-0">
        {aggregatedStyleCss && <style dangerouslySetInnerHTML={{ __html: aggregatedStyleCss }} />}
        {children}
      </main>
    </div>
  );
}

