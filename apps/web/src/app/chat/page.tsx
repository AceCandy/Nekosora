import { getTranslations } from "next-intl/server";
import { getVisibleModels } from "@/features/chat/actions/conversations";
import { listMyCards } from "@/features/panel/cards/actions";
import { listEnabledOutputModes } from "@/lib/output-modes/service";
import { listEnabledRenderStyles } from "@/lib/render-styles/service";
import ChatComposer from "@/features/chat/components/ChatComposer";
import { createShare, listConversationShares, revokeShare, type CreateShareInput } from "@/features/chat/actions/share";
import { toComposerOptions } from "@/features/chat/model/composerOptions";
import { newConversationKey } from "@/features/chat/model/newConversationNavigation";
import { requireSession } from "@/lib/session";
import { isWebSearchEnabled } from "@nekusora/core/web-search/registry";

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
  const { models, modes, styles } = toComposerOptions(visibleModels, outputModes, renderStyles);

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
