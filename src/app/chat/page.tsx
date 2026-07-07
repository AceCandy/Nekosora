import { getTranslations } from "next-intl/server";
import { getVisibleModels } from "@/features/chat/actions/conversations";
import { listMyCards } from "@/features/panel/cards/actions";
import { listKnowledgeBases } from "@/lib/knowledge-base/service";
import { listEnabledOutputModes } from "@/lib/output-modes/service";
import { listEnabledRenderStyles } from "@/lib/render-styles/service";
import ChatComposer, { type ModelOption } from "@/features/chat/components/ChatComposer";

export default async function ChatPage() {
  void getTranslations("chat");
  const [{ globals, byos }, cards, kbs, outputModes, renderStyles] = await Promise.all([
    getVisibleModels(),
    listMyCards(),
    listKnowledgeBases().catch(() => []),
    listEnabledOutputModes().catch(() => []),
    listEnabledRenderStyles().catch(() => []),
  ]);
  const models: ModelOption[] = [
    ...globals.map((m: Record<string, unknown>) => ({
      name: m.name as string,
      displayName: (m.displayName as string | undefined) ?? undefined,
    })),
    ...byos.map((r: Record<string, unknown>) => ({
      name: (r.model as Record<string, unknown>).name as string,
      displayName: (r.model as Record<string, unknown>).displayName as string | undefined,
    })),
  ];
  const knowledgeBases = (kbs as { id: string; name: string; fileCount: number }[]).map((kb) => ({
    id: kb.id,
    name: kb.name,
    fileCount: kb.fileCount,
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

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      <ChatComposer models={models} cards={cards} knowledgeBases={knowledgeBases} outputModes={modes} renderStyles={styles} />
    </div>
  );
}
