"use client";
import { useState, useEffect, useRef, useCallback, useDeferredValue } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { AlertCircle, Code, Cpu, Lightbulb, PenLine, RefreshCw, SkipForward } from "lucide-react";
import { clsx } from "clsx";
import dynamic from "next/dynamic";
import type { Artifact } from "@/features/artifacts/ArtifactPanel";
import FilePreviewModal, { type PreviewableFile } from "@/shared/components/file-preview/FilePreviewModal";
import { useChatRuntime } from "@/features/chat/hooks/useChatRuntime";
import { useChatAttachments } from "@/features/chat/hooks/useChatAttachments";
import { useComposerCoordinator } from "@/features/chat/hooks/useComposerCoordinator";
import { ChatMessageList } from "@/features/chat/components/ChatMessageList";
import { ChatToolbar, ComposerPlusMenu, ModelControlMenu, RenderStyleMenu, type ChatToolbarProps } from "@/features/chat/components/ChatToolbar";
import { ChatInputBox } from "@/features/chat/components/ChatInputBox";
import { AIXIcon } from "@/shared/components/animated-icons";
import ChatHeader from "@/features/chat/components/ChatHeader";
import { useChatStreamStore } from "@/features/chat/store/chatStreamStore";
import { saveConversationComposerState } from "@/features/chat/actions/conversations";
import type { ChatMessage, ModelOption, CardOption, OutputModeOption, RenderStyleOption } from "@/features/chat/model/types";
import type { ReasoningLevel } from "@/db/types";
import type { ConversationShareListItem, CreateShareInput } from "@/features/chat/actions/share";
import {
  createComposerSelectionState,
  resolveComposerSnapshot,
  type ComposerSelectionState,
} from "@/features/chat/model/composerState";
import { BROWSER_OFFLINE_REASON } from "@/features/chat/lib/network";

export type { ChatMessage, ModelOption, CardOption, OutputModeOption, RenderStyleOption } from "@/features/chat/model/types";

// Artifact 面板是低频功能且携带语法高亮/mermaid 等重依赖,按需加载,不进聊天首包。
const ArtifactPanel = dynamic(() =>
  import("@/features/artifacts/ArtifactPanel").then((m) => m.ArtifactPanel),
);

interface ChatComposerProps {
  models: ModelOption[];
  /** 可用的指令卡(空数组则不启用斜杠命令)。 */
  cards?: CardOption[];
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
  /** 当前用户是否已配置联网搜索。 */
  webSearchAvailable?: boolean;
  /** 当前会话已选指令卡(回填)。 */
  initialCardIds?: string[];
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
 *   - ChatInputBox：自适应输入框 + 发送/停止
 */
export default function ChatComposer({
  models,
  cards = [],
  outputModes = [],
  initialOutputModeId = null,
  renderStyles = [],
  initialRenderStyleId = null,
  initialModelName = null,
  initialWebSearch = false,
  webSearchAvailable = false,
  initialCardIds = [],
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
  const [outputModePickerOpen, setOutputModePickerOpen] = useState(false);
  const [renderStylePickerOpen, setRenderStylePickerOpen] = useState(false);
  // 活动会话 id:历史会话来自路由参数;新会话建会后由 useChatRuntime 回写,使订阅键与持久化目标跟随切换。
  const [activeConvId, setActiveConvId] = useState<string | undefined>(initialConvId);
  // 消息排队:流式期间 Enter 把草稿压入队列,流结束自动按序发出。
  // 会话切换经 key 重挂载天然清空队列,无需额外重置。
  const [queue, setQueue] = useState<string[]>([]);
  const queueRef = useRef<string[]>([]);
  const [initialComposerState] = useState(() => createComposerSelectionState({
    models,
    initialModelName,
    initialCardIds,
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
        reasoningByModelId: snapshot.reasoningByModelId,
      });
    },
  });
  const {
    modelId: model,
    cardIds: selectedCardIds,
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
  const handleRequestRejected = useCallback((reason: string) => {
    setSendError(reason === BROWSER_OFFLINE_REASON ? t("browserOffline") : reason);
  }, [t]);
  const runtime = useChatRuntime({
    conversationId: activeConvId ?? null,
    initialMessages,
    hasAttachments: attached.length > 0,
    uploadAttachments: uploadPending,
    onAttachmentsConsumed: clearConsumedAttachments,
    onRequestRejected: handleRequestRejected,
    onConversationCreated: (newConversationId) => {
      const persistedSnapshot = pendingCreateSnapshotRef.current ?? composer.getSnapshot();
      composer.adoptConversation(newConversationId, persistedSnapshot);
      pendingCreateSnapshotRef.current = null;
      setActiveConvId(newConversationId);
    },
  });
  // 空会话欢迎态同步到全局 store:驱动视口级天幕(ChatAtmosphere)与侧栏透明化。
  // 写外部 store 属 effect 正当用途;卸载时复位,避免离开聊天页后残留。
  const setWelcomeMode = useChatStreamStore((s) => s.setWelcomeMode);
  useEffect(() => {
    const empty = runtime.messages.length === 0;
    setWelcomeMode(empty);
    return () => setWelcomeMode(false);
  }, [runtime.messages.length, setWelcomeMode]);
  // 以下回调依赖的 runtime 方法均为 useMemo 稳定引用;models 为会话级 props(低频变化)。
  // 保持回调引用稳定,否则流式期间 runtime.messages 每帧更新会让整棵消息列表的
  // ChatMessageItem memo 被不稳定 props 击穿,逐帧重渲染。
  const { regenerate, editAndResend, continueGeneration } = runtime;
  const handleRegenerate = useCallback(
    (publicId: string, modelId: string) => {
      setSendError(null);
      const name = models.find((m) => m.modelId === modelId)?.name ?? modelId;
      regenerate(publicId, name, modelId);
    },
    [models, regenerate],
  );
  const handleEditAndResend = useCallback(
    (publicId: string, newContent: string, attachmentFileIds: string[], modelId: string) => {
      setSendError(null);
      const name = models.find((m) => m.modelId === modelId)?.name ?? modelId;
      editAndResend(publicId, newContent, attachmentFileIds, name, modelId);
    },
    [models, editAndResend],
  );
  const handleContinue = useCallback(
    (id: string) => {
      setSendError(null);
      continueGeneration(id, modelName, model);
    },
    [continueGeneration, modelName, model],
  );
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
      {
        outputModeId: snapshot.outputModeId,
        renderStyleId: snapshot.renderStyleId,
        reasoning: snapshot.reasoning,
        reasoningByModelId: snapshot.reasoningByModelId,
      },
      lifecycle,
    );
  };

  // ===== 消息排队:流式期间 Enter 压入队列,流结束自动按序发出 =====
  // sendWithCurrentSnapshot 的最新引用,供 drain effect 在流结束时刻调用
  const sendRef = useRef(sendWithCurrentSnapshot);
  useEffect(() => {
    sendRef.current = sendWithCurrentSnapshot;
  });
  useEffect(() => {
    queueRef.current = queue;
  });
  // 仅在流式 true→false 的边沿 drain 队首;rAF 包裹以避开 effect 内同步 setState 的限制
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = runtime.streaming;
    if (!wasStreaming || runtime.streaming) return;
    const raf = requestAnimationFrame(() => {
      const [next, ...rest] = queueRef.current;
      if (next === undefined) return;
      queueRef.current = rest;
      setQueue(rest);
      sendRef.current(next, {
        onRejected: () => {
          setInput((current) => (current.trim() ? `${current}\n${next}` : next));
        },
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [runtime.streaming]);

  /** 取回排队消息到输入框编辑(非空草稿以换行追加)。 */
  const takeBackQueueItem = (index: number) => {
    const text = queueRef.current[index];
    if (text === undefined) return;
    const next = queueRef.current.filter((_, i) => i !== index);
    queueRef.current = next;
    setQueue(next);
    setInput((prev) => (prev.trim() ? `${prev}\n${text}` : text));
  };
  /** 插队:移到队首并停止当前生成,流停止的边沿会自动把它发出去。 */
  const guideQueueItem = (index: number) => {
    const text = queueRef.current[index];
    if (text === undefined) return;
    const next = [text, ...queueRef.current.filter((_, i) => i !== index)];
    queueRef.current = next;
    setQueue(next);
    runtime.stopGeneration();
  };
  const removeQueueItem = (index: number) => {
    const next = queueRef.current.filter((_, i) => i !== index);
    queueRef.current = next;
    setQueue(next);
  };

  const handleSend = () => {
    // 滚动锚定由 message-scroller 的 scrollAnchor(user 消息)自动处理,无需手动 pin。
    const submittedInput = input;
    setSendError(null);
    // 流式期间发送转为排队:文本压入队列,流结束后自动按序发出;附件留在输入器,不随队列静默提交
    if (runtime.streaming) {
      const text = submittedInput.trim();
      if (text) {
        const next = [...queueRef.current, text];
        queueRef.current = next;
        setQueue(next);
        setInput("");
      }
      return;
    }
    sendWithCurrentSnapshot(submittedInput, {
      onAccepted: () => {
        setInput("");
        setSendError(null);
      },
      onRejected: () => {
        setInput((current) => current || submittedInput);
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
  const deferredRenderStyle = useDeferredValue(activeRenderStyle);

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

  if (models.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400 p-8">
        <div className="text-center space-y-2 max-w-sm">
          <Cpu className="w-8 h-8 mx-auto text-neutral-300 " aria-hidden="true" />
          <h3 className="text-ui-body font-semibold">{t("noModels")}</h3>
          <p className="text-ui-caption text-ink-tertiary  leading-relaxed">
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
    onUploadFiles: handleUpload,
    onRemoveAttachment: removeAttachment,
    onPreviewFile: setPreviewFile,
    cards,
    selectedCardIds,
    onCardToggle: handleCardToggle,
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
    webSearchAvailable,
    onWebSearchToggle: handleWebSearchToggle,
    reasoning,
    onReasoningChange: handleReasoningChange,
  };
  const isEmptyConversation = runtime.messages.length === 0;
  const canShare = !runtime.streaming && runtime.messages.length > 0 && runtime.messages.every((message) => message.publicId);

  return (
    <div className="flex-1 flex h-full bg-nebula-white  transition-colors duration-250">
      {/* 主区:消息 + 输入(可被 artifact 面板挤压) */}
      <div className={clsx("relative flex flex-col h-full min-w-0 flex-1", activeArtifact && "lg:flex-[3] lg:border-r lg:border-morning-mist ")}>
        <ChatHeader
          title={conversationTitle}
          transparent={isEmptyConversation}
          renderStyleMenu={<RenderStyleMenu {...toolbarProps} />}
          conversationId={activeConvId}
          canShare={canShare}
          createShareAction={createShareAction}
          listSharesAction={listSharesAction}
          revokeShareAction={revokeShareAction}
        />
        <ChatMessageList
          messages={runtime.messages}
          streaming={runtime.streaming}
          conversationId={activeConvId}
          bottomInset={composerHeight + 16}
          model={model}
          renderStyleClass={deferredRenderStyle?.cssClass ?? null}
          renderStyleRenderer={deferredRenderStyle?.renderer}
          isPaper={deferredRenderStyle?.cssClass === "paper"}
          onRegenerate={handleRegenerate}
          onEdit={handleEditAndResend}
          onSwitchVersion={runtime.switchVersion}
          onOpenArtifact={setActiveArtifact}
          onPreviewFile={setPreviewFile}
          onDelete={runtime.deleteMessage}
          onContinue={handleContinue}
          onFeedbackChange={runtime.setMessageFeedbackLocal}
          models={models}
          onQuote={handleSelectionQuote}
          onAsk={handleSelectionAsk}
        />

        {/* 新会话将标题与输入器居中；开始对话后输入器回到底部。 */}
        {/* 输入器始终锚定底部;空会话欢迎态以 transform 上提至视觉中心(composer-welcome-lift),
            首条消息发出后 500ms expo 滑回底部——门面退场编排的签名动效。 */}
        <div
          className={clsx(
            "absolute inset-x-0 bottom-0 z-10 pointer-events-none transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            isEmptyConversation && "composer-welcome-lift",
          )}
        >
          <div
            ref={composerRef}
            className={clsx(
              "pointer-events-auto mx-auto w-[calc(100%_-_2rem)] max-w-[75ch] space-y-2 pb-[env(safe-area-inset-bottom)]",
              !isEmptyConversation && "mb-4",
            )}
          >
            {isEmptyConversation && (
              <>
                <div className="welcome-rise mb-10 flex flex-col items-center text-center">
                  <Image src="/icon.svg" alt="" width={64} height={64} className="brightness-0" priority />
                  <h1 className="mt-6 text-ui-facade font-extrabold tracking-[-0.03em] text-space-ink [text-wrap:balance]">
                    {t("welcomeTitle")}
                  </h1>
                  <p className="mt-3 text-ui-reading text-ink-secondary">{t("welcomeSubtitle")}</p>
                </div>
              </>
            )}
            {/* 排队条:流式期间 Enter 压入的待发送消息;点文本取回编辑,⏭ 插队到队首并停止当前生成,× 移除 */}
            {queue.length > 0 && (
              <div className="menu-pop rounded-xl border border-morning-mist bg-nebula-silver/25 px-2 py-1.5">
                {queue.map((text, i) => (
                  <div key={`${i}-${text.slice(0, 12)}`} className="group/queue flex items-center gap-2 rounded-md px-1.5 py-1">
                    <span className="w-4 shrink-0 text-center font-mono text-ui-micro tabular-nums text-ink-tertiary">{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => takeBackQueueItem(i)}
                      title={t("queueEditHint")}
                      className="min-w-0 flex-1 truncate text-left text-ui-caption text-neutral-700 hover:text-neutral-900 cursor-pointer"
                    >
                      {text}
                    </button>
                    <button
                      type="button"
                      onClick={() => guideQueueItem(i)}
                      title={t("queueGuide")}
                      aria-label={t("queueGuide")}
                      className="touch-target inline-flex h-6 w-6 items-center justify-center rounded text-ink-tertiary hover:text-sora-blue hover:bg-sora-blue/[0.08] cursor-pointer"
                    >
                      <SkipForward className="h-3 w-3" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeQueueItem(i)}
                      aria-label={t("delete")}
                      className="ai-trigger touch-target inline-flex h-6 w-6 items-center justify-center rounded text-ink-tertiary hover:text-danger cursor-pointer"
                    >
                      <AIXIcon className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* 空会话时输入器随欢迎区做第二拍入场;对话中非空会话不挂载入场类,避免重复动效 */}
            <div className={clsx(isEmptyConversation && "welcome-rise")} style={isEmptyConversation ? { animationDelay: "140ms" } : undefined}>
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
                    <p role="alert" className="flex items-center gap-1.5 px-3 pb-1 text-ui-caption text-danger ">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{sendError}</span>
                    </p>
                  )}
                  {composer.syncStatus === "error" && (
                    <div role="alert" className="flex items-center gap-1.5 px-3 pb-1 text-ui-caption text-danger ">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1">{t("composerSyncFailed")}</span>
                      <button
                        type="button"
                        onClick={composer.retry}
                        className="touch-target inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors duration-150 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue "
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
            {/* 建议提示词:空会话的教学式入口,点击填充输入框(不直接发送,交给用户确认) */}
            {isEmptyConversation && (
              <div className="welcome-rise flex flex-wrap items-center justify-center gap-2 pt-4" style={{ animationDelay: "260ms" }}>
                {([
                  { key: "suggestExplain", Icon: Lightbulb },
                  { key: "suggestWrite", Icon: PenLine },
                  { key: "suggestCode", Icon: Code },
                ] as const).map(({ key, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setInput(t(key))}
                    className="group inline-flex items-center gap-1.5 rounded-full border border-morning-mist bg-white px-4 py-2 text-ui-caption text-ink-secondary transition-colors hover:border-sora-blue/40 hover:bg-sora-blue/[0.04] hover:text-sora-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
                  >
                    <Icon className="h-3.5 w-3.5 text-ink-tertiary transition-colors group-hover:text-sora-blue" aria-hidden="true" />
                    {t(key)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Artifact 面板:桌面右侧并排(可关闭);小屏改为全屏覆盖,避免功能静默失效 */}
      {activeArtifact && (
        <div className="fixed inset-0 z-40 flex h-full bg-nebula-white lg:static lg:z-auto lg:flex-[2]">
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
