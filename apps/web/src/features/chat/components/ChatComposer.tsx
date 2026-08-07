"use client";
import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { AlertCircle, Cpu, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { ArtifactPanel, type Artifact } from "@/features/artifacts/ArtifactPanel";
import FilePreviewModal, { type PreviewableFile } from "@/shared/components/file-preview/FilePreviewModal";
import { useChatRuntime } from "@/features/chat/hooks/useChatRuntime";
import { useChatAttachments } from "@/features/chat/hooks/useChatAttachments";
import { useComposerCoordinator } from "@/features/chat/hooks/useComposerCoordinator";
import { ChatMessageList } from "@/features/chat/components/ChatMessageList";
import { ChatToolbar, ComposerPlusMenu, ModelControlMenu, type ChatToolbarProps } from "@/features/chat/components/ChatToolbar";
import { ChatInputBox } from "@/features/chat/components/ChatInputBox";
import ChatHeader from "@/features/chat/components/ChatHeader";
import { useChatStreamStore } from "@/features/chat/store/chatStreamStore";
import { saveConversationComposerState } from "@/features/chat/actions/conversations";
import type { ChatMessage, ModelOption, CardOption, KnowledgeBaseOption, OutputModeOption, RenderStyleOption } from "@/features/chat/model/types";
import type { ReasoningLevel } from "@/db/types";
import type { ConversationShareListItem, CreateShareInput } from "@/features/chat/actions/share";
import {
  createComposerSelectionState,
  resolveComposerSnapshot,
  type ComposerSelectionState,
} from "@/features/chat/model/composerState";

export type { ChatMessage, ModelOption, CardOption, KnowledgeBaseOption, OutputModeOption, RenderStyleOption } from "@/features/chat/model/types";

interface ChatComposerProps {
  models: ModelOption[];
  /** 可用的指令卡(空数组则不显示选择器)。 */
  cards?: CardOption[];
  /** 可用的知识库(空数组则不显示选择器)。 */
  knowledgeBases?: KnowledgeBaseOption[];
  /** 可用的输出模式(空数组则不显示选择器)。 */
  outputModes?: OutputModeOption[];
  /** 当前会话已选的输出模式 ID(undefined=新会话未选)。 */
  initialOutputModeId?: string | null;
  /** 可用的输出样式(空数组则不显示选择器)。 */
  renderStyles?: RenderStyleOption[];
  /** 当前会话已选的输出样式 ID(undefined=新会话未选)。 */
  initialRenderStyleId?: string | null;
  /** 当前会话已选模型名(回填;未传则用列表首项)。 */
  initialModelName?: string | null;
  /** 当前会话联网状态(回填)。 */
  initialWebSearch?: boolean;
  /** 当前会话已选指令卡(回填)。 */
  initialCardIds?: string[];
  /** 当前会话已选知识库(回填)。 */
  initialKbIds?: string[];
  /** 当前会话按模型保存的推理级别。 */
  initialReasoningByModelId?: Record<string, ReasoningLevel>;
  /** 当前会话 ID(切换输出模式时持久化用;新会话无)。 */
  conversationId?: string;
  /** 当前会话标题;新会话未传时使用既有翻译。 */
  initialTitle?: string;
  /** 分享当前会话的 server action(由 page 提供,ChatHeader 用)。 */
  createShareAction: (input: CreateShareInput) => Promise<ConversationShareListItem>;
  listSharesAction: (conversationId: string) => Promise<ConversationShareListItem[]>;
  revokeShareAction: (shareId: string) => Promise<void>;
  initialMessages?: ChatMessage[];
}

/**
 * ChatComposer —— 纯编排层。
 *
 * 持有所有会话级 selection state 与持久化逻辑，把渲染拆给三个子组件：
 *   - ChatMessageList：消息滚动区 + 对话大纲
 *   - ChatToolbar：已选资源与附件状态
 *   - ChatInputBox：自适应输入框 + 紧凑设置入口 + 发送/停止
 */
export default function ChatComposer({
  models,
  cards = [],
  knowledgeBases = [],
  outputModes = [],
  initialOutputModeId = null,
  renderStyles = [],
  initialRenderStyleId = null,
  initialModelName = null,
  initialWebSearch = false,
  initialCardIds = [],
  initialKbIds = [],
  initialReasoningByModelId = {},
  conversationId: initialConvId,
  initialTitle,
  createShareAction,
  listSharesAction,
  revokeShareAction,
  initialMessages = [],
}: ChatComposerProps) {
  const t = useTranslations("chat");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [input, setInput] = useState("");
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const [outputModePickerOpen, setOutputModePickerOpen] = useState(false);
  const [renderStylePickerOpen, setRenderStylePickerOpen] = useState(false);
  // 活动会话 id:历史会话来自路由参数;新会话建会后由 useChatRuntime 回写,使订阅键与持久化目标跟随切换。
  const [activeConvId, setActiveConvId] = useState<string | undefined>(initialConvId);
  const [initialComposerState] = useState(() => createComposerSelectionState({
    models,
    initialModelName,
    initialCardIds,
    initialKbIds,
    initialWebSearch,
    initialOutputModeId,
    initialRenderStyleId,
    initialReasoningByModelId,
  }));
  const composer = useComposerCoordinator({
    conversationId: initialConvId ?? null,
    initialState: initialComposerState,
    persistSnapshot: async (conversationId, selection) => {
      const snapshot = resolveComposerSnapshot(selection, models);
      await saveConversationComposerState(conversationId, {
        modelName: snapshot.modelName,
        outputModeId: snapshot.outputModeId,
        renderStyleId: snapshot.renderStyleId,
        webSearch: snapshot.webSearch,
        cardIds: snapshot.cardIds,
        kbIds: snapshot.kbIds,
        reasoningByModelId: snapshot.reasoningByModelId,
      });
    },
  });
  const {
    modelId: model,
    cardIds: selectedCardIds,
    kbIds: selectedKbIds,
    webSearch,
    outputModeId,
    renderStyleId,
  } = composer.state;
  const resolvedComposer = resolveComposerSnapshot(composer.state, models);
  const modelName = resolvedComposer.modelName;
  const reasoning = resolvedComposer.reasoning;
  const pendingCreateSnapshotRef = useRef<ComposerSelectionState | null>(null);
  const optimisticTitle = useChatStreamStore((state) =>
    activeConvId && state.optimisticConversation?.id === activeConvId
      ? state.optimisticConversation.title
      : null,
  );
  const conversationTitle = optimisticTitle || initialTitle || t("newConversation");

  // 浮动输入区高度:ResizeObserver 测量,用于消息区底部留白与"回到最新"按钮定位
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(160);
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const update = () => setComposerHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const {
    attached,
    handleUpload,
    removeAttachment,
    clearConsumedAttachments,
    uploadPending,
  } = useChatAttachments(activeConvId ?? null);
  const runtime = useChatRuntime({
    conversationId: activeConvId ?? null,
    initialMessages,
    hasAttachments: attached.length > 0,
    uploadAttachments: uploadPending,
    onAttachmentsConsumed: clearConsumedAttachments,
    onConversationCreated: (newConversationId) => {
      const persistedSnapshot = pendingCreateSnapshotRef.current ?? composer.getSnapshot();
      composer.adoptConversation(newConversationId, persistedSnapshot);
      pendingCreateSnapshotRef.current = null;
      setActiveConvId(newConversationId);
    },
  });
  const sendWithCurrentSnapshot = (
    text: string,
    lifecycle?: { onAccepted?: () => void; onRejected?: (message: string) => void },
  ) => {
    const selection = composer.getSnapshot();
    const snapshot = resolveComposerSnapshot(selection, models);
    if (!activeConvId) pendingCreateSnapshotRef.current = selection;
    runtime.send(
      text,
      snapshot.modelName,
      snapshot.modelId,
      snapshot.cardIds,
      snapshot.webSearch,
      snapshot.kbIds,
      {
        outputModeId: snapshot.outputModeId,
        renderStyleId: snapshot.renderStyleId,
        reasoning: snapshot.reasoning,
        reasoningByModelId: snapshot.reasoningByModelId,
      },
      lifecycle,
    );
  };

  const handleSend = () => {
    // 滚动锚定由 message-scroller 的 scrollAnchor(user 消息)自动处理,无需手动 pin。
    const submittedInput = input;
    setSendError(null);
    sendWithCurrentSnapshot(submittedInput, {
      onAccepted: () => {
        setInput("");
        setSendError(null);
      },
      onRejected: (message) => {
        setInput((current) => current || submittedInput);
        setSendError(message);
      },
    });
  };

  // 选中文本「引用」:以 Markdown 引用块插入输入框末尾
  const handleSelectionQuote = (text: string) => {
    setInput((prev) => (prev.trim() ? `${prev}\n\n> ${text}\n\n` : `> ${text}\n\n`));
  };
  // 选中文本「追问」:以选中文本为新问题直接发送(继续当前会话,不走分支)
  const handleSelectionAsk = (text: string) => {
    sendWithCurrentSnapshot(text);
  };

  // 推理级别按「会话 + 具体模型」持久化,切换模型时恢复各自档位。
  const handleReasoningChange = (next: ReasoningLevel) => {
    composer.dispatch({
      type: "setModelReasoning",
      modelId: composer.getSnapshot().modelId,
      reasoning: next,
    });
  };

  // 当前选中的样式 cssClass(供 ChatMessageList 套容器 class),null 表示用默认渲染
  const activeRenderStyle = renderStyleId
    ? renderStyles.find((s) => s.id === renderStyleId) ?? null
    : null;
  const activeRenderStyleClass = activeRenderStyle?.cssClass ?? null;
  const activeRenderStyleRenderer = activeRenderStyle?.renderer;

  // ===== 选择回调：同步更新权威快照，由 coordinator 顺序持久化 =====
  const handleRenderStyleChange = (id: string) => {
    composer.dispatch({ type: "selectRenderStyle", id: id || null });
  };

  const handleOutputModeChange = (id: string) => {
    composer.dispatch({ type: "selectOutputMode", id: id || null });
  };

  const handleModelChange = (next: string) => {
    composer.dispatch({ type: "selectModel", modelId: next });
  };

  const handleWebSearchToggle = () => {
    composer.dispatch({ type: "toggleWebSearch" });
  };

  // 指令卡 toggle(多选)
  const handleCardToggle = (id: string) => {
    composer.dispatch({ type: "toggleCard", id });
  };

  // 知识库 toggle(多选)
  const handleKbToggle = (id: string) => {
    composer.dispatch({ type: "toggleKnowledgeBase", id });
  };

  if (models.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400 p-8">
        <div className="text-center space-y-2 max-w-sm">
          <Cpu className="w-8 h-8 mx-auto text-neutral-300 dark:text-neutral-700 animate-pulse" aria-hidden="true" />
          <h3 className="text-ui-body font-semibold">{t("noModels")}</h3>
          <p className="text-ui-caption text-neutral-450 dark:text-neutral-500 leading-relaxed">
            {t("noModelsDesc")}
          </p>
        </div>
      </div>
    );
  }

  const toolbarProps: ChatToolbarProps = {
    models,
    model,
    onModelChange: handleModelChange,
    modelPickerOpen,
    onModelPickerToggle: () => setModelPickerOpen((value) => !value),
    onModelPickerClose: () => setModelPickerOpen(false),
    attached,
    onRemoveAttachment: removeAttachment,
    onPreviewFile: setPreviewFile,
    cards,
    selectedCardIds,
    cardPickerOpen,
    onCardPickerToggle: () => setCardPickerOpen((value) => !value),
    onCardPickerClose: () => setCardPickerOpen(false),
    onCardToggle: handleCardToggle,
    knowledgeBases,
    selectedKbIds,
    kbPickerOpen,
    onKbPickerToggle: () => setKbPickerOpen((value) => !value),
    onKbPickerClose: () => setKbPickerOpen(false),
    onKbToggle: handleKbToggle,
    outputModes,
    outputModeId,
    outputModePickerOpen,
    onOutputModePickerToggle: () => setOutputModePickerOpen((value) => !value),
    onOutputModePickerClose: () => setOutputModePickerOpen(false),
    onOutputModeToggle: handleOutputModeChange,
    onOutputModeClear: () => handleOutputModeChange(""),
    renderStyles,
    renderStyleId,
    renderStylePickerOpen,
    onRenderStylePickerToggle: () => setRenderStylePickerOpen((value) => !value),
    onRenderStylePickerClose: () => setRenderStylePickerOpen(false),
    onRenderStyleToggle: handleRenderStyleChange,
    onRenderStyleClear: () => handleRenderStyleChange(""),
    webSearch,
    onWebSearchToggle: handleWebSearchToggle,
    reasoning,
    onReasoningChange: handleReasoningChange,
  };
  const isEmptyConversation = runtime.messages.length === 0;
  const canShare = !runtime.streaming && runtime.messages.length > 0 && runtime.messages.every((message) => message.publicId);

  return (
    <div className="flex-1 flex h-full bg-nebula-white dark:bg-twilight-obsidian transition-colors duration-250">
      {/* 主区:消息 + 输入(可被 artifact 面板挤压) */}
      <div className={clsx("relative flex flex-col h-full min-w-0 flex-1", activeArtifact && "lg:flex-[3] lg:border-r lg:border-morning-mist lg:dark:border-deep-space/80")}>
        {activeConvId && (
          <ChatHeader
            title={conversationTitle}
            conversationId={activeConvId}
            canShare={canShare}
            createShareAction={createShareAction}
            listSharesAction={listSharesAction}
            revokeShareAction={revokeShareAction}
          />
        )}
        <ChatMessageList
          messages={runtime.messages}
          streaming={runtime.streaming}
          conversationId={activeConvId}
          bottomInset={composerHeight + 16}
          model={model}
          renderStyleClass={activeRenderStyleClass}
          renderStyleRenderer={activeRenderStyleRenderer}
          onRegenerate={(publicId, modelId) => {
            const name = models.find((m) => m.modelId === modelId)?.name ?? modelId;
            runtime.regenerate(publicId, name, modelId);
          }}
          onEdit={(publicId, newContent, attachmentFileIds, modelId) => {
            const name = models.find((m) => m.modelId === modelId)?.name ?? modelId;
            runtime.editAndResend(publicId, newContent, attachmentFileIds, name, modelId);
          }}
          onSwitchVersion={runtime.switchVersion}
          onOpenArtifact={setActiveArtifact}
          onDelete={runtime.deleteMessage}
          onContinue={(id) => runtime.continueGeneration(id, modelName, model)}
          onFeedbackChange={runtime.setMessageFeedbackLocal}
          models={models}
          onQuote={handleSelectionQuote}
          onAsk={handleSelectionAsk}
        />

        {/* 新会话将标题与输入器居中；开始对话后输入器回到底部。 */}
        <div
          className={clsx(
            "absolute inset-x-0 z-10 pointer-events-none",
            isEmptyConversation ? "top-[42%] -translate-y-1/2 md:top-[44%]" : "bottom-0",
          )}
        >
          <div
            ref={composerRef}
            className={clsx(
              "pointer-events-auto mx-auto w-[calc(100%_-_2rem)] max-w-3xl space-y-2",
              !isEmptyConversation && "mb-4",
            )}
          >
            {isEmptyConversation && (
              <h1 className="mb-6 flex items-center justify-center gap-2 text-center text-ui-heading font-semibold text-space-ink dark:text-nebula-silver">
                <Image src="/icon.svg" alt="" width={56} height={56} className="brightness-0 dark:invert" priority />
                {t("welcomeTitle")}
              </h1>
            )}
            <ChatInputBox
              value={input}
              onChange={setInput}
              onSend={handleSend}
              disabled={runtime.streaming}
              onStop={runtime.stopGeneration}
              onPasteFiles={handleUpload}
              onDropFiles={handleUpload}
              hasAttachments={attached.length > 0}
              cards={cards}
              onCardToggle={handleCardToggle}
              topContent={(
                <>
                  <ChatToolbar {...toolbarProps} />
                  {sendError && (
                    <p role="alert" className="flex items-center gap-1.5 px-3 pb-1 text-ui-caption text-red-600 dark:text-red-400">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{sendError}</span>
                    </p>
                  )}
                  {composer.syncStatus === "error" && (
                    <div role="alert" className="flex items-center gap-1.5 px-3 pb-1 text-ui-caption text-red-600 dark:text-red-400">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1">{t("composerSyncFailed")}</span>
                      <button
                        type="button"
                        onClick={composer.retry}
                        className="touch-target inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors duration-150 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:hover:bg-red-950/30"
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{t("retry")}</span>
                      </button>
                    </div>
                  )}
                </>
              )}
              leadingControl={<ComposerPlusMenu {...toolbarProps} />}
              trailingControl={<ModelControlMenu {...toolbarProps} />}
            />
          </div>
        </div>
      </div>
      {/* Artifact 面板(右侧,可关闭) */}
      {activeArtifact && (
        <div className="hidden lg:flex lg:flex-[2] h-full">
          <ArtifactPanel
            artifact={activeArtifact}
            onClose={() => setActiveArtifact(null)}
            className="w-full"
          />
        </div>
      )}

      {/* 文件预览弹窗 */}
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}
