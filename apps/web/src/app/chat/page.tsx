import { getTranslations } from "next-intl/server";
import { getVisibleModels } from "@/features/chat/actions/conversations";
import { listMyCards } from "@/features/panel/cards/actions";
import { listEnabledOutputModes } from "@/lib/output-modes/service";
import { listEnabledRenderStyles } from "@/lib/render-styles/service";
import ChatComposer, { type ModelOption } from "@/features/chat/components/ChatComposer";
import { createShare, listConversationShares, revokeShare, type CreateShareInput } from "@/features/chat/actions/share";
import type { ModelCapabilities } from "@/db/types";
import { newConversationKey } from "@/features/chat/model/newConversationNavigation";
import { requireSession } from "@/lib/session";
import { isWebSearchEnabled } from "@/lib/web-search/registry";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const composerKey = newConversationKey(await searchParams);
  void getTranslations("chat");
  const user = await requireSession();
  const [visibleModels, cards, outputModes, renderStyles, webSearchAvailable] = await Promise.all([
    getVisibleModels(),
    listMyCards(),
    listEnabledOutputModes().catch(() => []),
    listEnabledRenderStyles().catch(() => []),
    isWebSearchEnabled(user.id).catch(() => false),
  ]);
  // getVisibleModels 已返回扁平数组且 private 排序在前,直接映射为 ModelOption[]。
  const models: ModelOption[] = (visibleModels as Record<string, unknown>[]).map((m) => ({
    modelId: m.id as string,
    name: m.name as string,
    displayName: (m.displayName as string | undefined) ?? undefined,
    capabilities: (m.capabilities as ModelCapabilities | undefined) ?? undefined,
    source: m.visibility === "public" ? ("global" as const) : ("byo" as const),
  }));
  const modes = (outputModes as { id: string; name: string; description?: string | null; icon?: string | null }[]).map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    icon: m.icon,
  }));
  const styles = (renderStyles as { id: string; cssClass: string; renderer: "streamdown" | "custom"; name: string; description?: string | null; icon?: string | null }[]).map((s) => ({
    id: s.id,
    cssClass: s.cssClass,
    renderer: s.renderer,
    name: s.name,
    description: s.description,
    icon: s.icon,
  }));

  async function handleCreateShare(input: CreateShareInput) {
    "use server";
    return createShare(input);
  }
  async function handleListShares(convId: string) {
    "use server";
    return listConversationShares(convId);
  }
  async function handleRevokeShare(shareId: string) {
    "use server";
    return revokeShare(shareId);
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      <ChatComposer key={composerKey} models={models} cards={cards} outputModes={modes} renderStyles={styles} initialWebSearch={webSearchAvailable} webSearchAvailable={webSearchAvailable} createShareAction={handleCreateShare} listSharesAction={handleListShares} revokeShareAction={handleRevokeShare} />
    </div>
  );
}
