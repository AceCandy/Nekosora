import { getTranslations } from "next-intl/server";
import { getVisibleModels, getArtifactsByConversation, getConversationComposerState } from "@/features/chat/actions/conversations";
import { getVisibleBranch } from "@/features/chat/actions/branch";
import { createShare } from "@/features/chat/actions/share";
import { listMyCards } from "@/features/panel/cards/actions";
import { listKnowledgeBases } from "@/lib/knowledge-base/service";
import { listEnabledOutputModes } from "@/lib/output-modes/service";
import { listEnabledRenderStyles } from "@/lib/render-styles/service";
import ChatComposer, { type ModelOption } from "@/features/chat/components/ChatComposer";
import type { ModelCapabilities } from "@/db/types";
import type { ChatMessage } from "@/features/chat/model/types";

export default async function ChatConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  void getTranslations("chat"); // 保持命名空间预热,与 chat/page 行为一致
  const [visibleModels, branch, artifactsMap, cards, kbs, outputModes, renderStyles, composerState] = await Promise.all([
    getVisibleModels(),
    getVisibleBranch(id).catch(() => ({ messages: [], versionMap: {} })),
    getArtifactsByConversation(id).catch(() => ({})),
    listMyCards(),
    listKnowledgeBases().catch(() => []),
    listEnabledOutputModes().catch(() => []),
    listEnabledRenderStyles().catch(() => []),
    getConversationComposerState(id).catch(() => ({
      modelName: null,
      outputModeId: null,
      renderStyleId: null,
      webSearch: false,
      cardIds: [],
      kbIds: [],
      temperature: null,
      topP: null,
      maxTokens: null,
      reasoningByModelId: {},
    })),
  ]);
  const msgs = branch.messages;
  const versionMap = branch.versionMap as Record<string, { current: number; total: number }>;
  // getVisibleModels 已返回扁平数组且 private 排序在前,直接映射为 ModelOption[](带 capabilities)。
  const models: ModelOption[] = (visibleModels as Record<string, unknown>[]).map((m) => ({
    modelId: m.id as string,
    name: m.name as string,
    displayName: (m.displayName as string | undefined) ?? undefined,
    capabilities: (m.capabilities as ModelCapabilities | undefined) ?? undefined,
    source: m.visibility === "public" ? ("global" as const) : ("byo" as const),
  }));

  // Convert messages to ChatComposer format(P1-B:关联 artifacts)
  const artifactsByMsg = artifactsMap as Record<string, { id: string; kind: string; title: string; language: string | null; content: string }[]>;
  const initialMessages = (msgs as Record<string, unknown>[]).map((m) => ({
    role: m.role as "user" | "assistant",
    content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
    reasoning: (m.reasoning as string | null) ?? undefined,
    publicId: m.publicId as string | undefined,
    status: m.status as ChatMessage["status"] | undefined,
    trace: m.processTrace as ChatMessage["trace"] | undefined,
    versionInfo: versionMap[m.id as string],
    artifacts: (artifactsByMsg[m.id as string] ?? []) as
      | { id: string; kind: "code" | "mermaid" | "svg" | "html" | "katex" | "markdown"; title: string; language: string | null; content: string }[]
      | undefined,
  }));

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

  // Server action wrapper for sharing
  async function handleCreateShare(convId: string) {
    "use server";
    return createShare(convId);
  }

  // 历史会话列表已上移至 chat/layout 的单栏侧栏,此处只渲染会话头部与聊天区。
  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      <div className="flex-1 min-h-0">
        <ChatComposer
          models={models}
          cards={cards}
          knowledgeBases={knowledgeBases}
          outputModes={modes}
          renderStyles={styles}
          initialModelName={composerState.modelName}
          initialOutputModeId={composerState.outputModeId}
          initialRenderStyleId={composerState.renderStyleId}
          initialWebSearch={composerState.webSearch}
          initialCardIds={composerState.cardIds}
          initialKbIds={composerState.kbIds}
          initialModelParams={{ temperature: composerState.temperature, topP: composerState.topP, maxTokens: composerState.maxTokens }}
          initialReasoningByModelId={composerState.reasoningByModelId}
          conversationId={id}
          createShareAction={handleCreateShare}
          initialMessages={initialMessages}
        />
      </div>
    </div>
  );
}
