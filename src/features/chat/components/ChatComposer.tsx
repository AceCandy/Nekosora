"use client";
import { useState, useEffect, useRef, useTransition } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Cpu } from "lucide-react";
import { clsx } from "clsx";
import { ArtifactPanel, type Artifact } from "@/features/artifacts/ArtifactPanel";
import FilePreviewModal, { type PreviewableFile } from "@/shared/components/file-preview/FilePreviewModal";
import { useChatRuntime } from "@/features/chat/hooks/useChatRuntime";
import { useChatAttachments } from "@/features/chat/hooks/useChatAttachments";
import { ChatMessageList } from "@/features/chat/components/ChatMessageList";
import { ChatToolbar, ComposerPlusMenu, ModelControlMenu, type ChatToolbarProps } from "@/features/chat/components/ChatToolbar";
import { ChatInputBox } from "@/features/chat/components/ChatInputBox";
import ChatHeader from "@/features/chat/components/ChatHeader";
import { useChatStreamStore } from "@/features/chat/store/chatStreamStore";
import { setConversationOutputMode, setConversationRenderStyle, setConversationModel, setConversationWebSearch, setConversationComposerState, setConversationModelReasoning } from "@/features/chat/actions/conversations";
import type { ChatMessage, ModelOption, CardOption, KnowledgeBaseOption, OutputModeOption, RenderStyleOption } from "@/features/chat/model/types";
import type { ReasoningLevel } from "@/db/types";
import { resolveReasoningForModel } from "@/lib/reasoning";

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
  createShareAction: (id: string) => Promise<string>;
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
  initialMessages = [],
}: ChatComposerProps) {
  const t = useTranslations("chat");
  // model 状态持有 modelId(选项唯一 id,配合 byId 路由解析)。
  // initialModelName 是会话回填的模型名(按 name 存库),映射回 modelId;重名时取首个(private 在前)。
  const [model, setModel] = useState(() => {
    if (initialModelName) {
      const found = models.find((m) => m.name === initialModelName)?.modelId;
      if (found) return found;
    }
    return models[0]?.modelId ?? "";
  });
  // 当前选中模型对外名(发消息/持久化仍需 name;子任务与用量日志沿用 name)。
  const modelName = models.find((m) => m.modelId === model)?.name ?? "";
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [input, setInput] = useState("");
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>(initialCardIds);
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  const [webSearch, setWebSearch] = useState(initialWebSearch);
  const [selectedKbIds, setSelectedKbIds] = useState<string[]>(initialKbIds);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const [outputModeId, setOutputModeId] = useState<string | null>(initialOutputModeId);
  const [outputModePickerOpen, setOutputModePickerOpen] = useState(false);
  const [renderStyleId, setRenderStyleId] = useState<string | null>(initialRenderStyleId);
  const [renderStylePickerOpen, setRenderStylePickerOpen] = useState(false);
  const [, startModeTransition] = useTransition();
  // 活动会话 id:历史会话来自路由参数;新会话建会后由 useChatRuntime 回写,使订阅键与持久化目标跟随切换。
  const [activeConvId, setActiveConvId] = useState<string | undefined>(initialConvId);
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
    uploadAttachments: uploadPending,
    onAttachmentsConsumed: clearConsumedAttachments,
    onConversationCreated: setActiveConvId,
  });
  // 流式结束后,刷新有 publicId 的 assistant 消息版本信息(用于版本切换器)
  useEffect(() => {
    if (runtime.streaming) return;
    const assistantIds = runtime.messages
      .filter((m) => m.role === "assistant" && m.publicId)
      .map((m) => m.publicId!);
    if (assistantIds.length === 0) return;
    assistantIds.forEach((pid) => runtime.refreshVersionInfo(pid));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime.streaming]);

  const handleSend = () => {
    // 滚动锚定由 message-scroller 的 scrollAnchor(user 消息)自动处理,无需手动 pin。
    runtime.send(input, modelName, model, selectedCardIds, webSearch, selectedKbIds, { outputModeId, renderStyleId, reasoning });
    setInput("");
  };

  // 选中文本「引用」:以 Markdown 引用块插入输入框末尾
  const handleSelectionQuote = (text: string) => {
    setInput((prev) => (prev.trim() ? `${prev}\n\n> ${text}\n\n` : `> ${text}\n\n`));
  };
  // 选中文本「追问」:以选中文本为新问题直接发送(继续当前会话,不走分支)
  const handleSelectionAsk = (text: string) => {
    runtime.send(text, modelName, model, selectedCardIds, webSearch, selectedKbIds, { outputModeId, renderStyleId, reasoning });
  };

  // 推理级别按「会话 + 具体模型」持久化,切换模型时恢复各自档位。
  const [reasoningByModelId, setReasoningByModelId] = useState(initialReasoningByModelId);
  const currentCapabilities = models.find((item) => item.modelId === model)?.capabilities;
  const reasoning = resolveReasoningForModel(currentCapabilities, model, reasoningByModelId);
  const handleReasoningChange = (next: ReasoningLevel) => {
    setReasoningByModelId((prev) => ({ ...prev, [model]: next }));
    const convId = activeConvId;
    if (convId) {
      startModeTransition(async () => {
        try { await setConversationModelReasoning(convId, model, next); }
        catch (err) { console.error("set reasoning failed:", err); }
      });
    }
  };

  // 当前选中的样式 cssClass(供 ChatMessageList 套容器 class),null 表示用默认渲染
  const activeRenderStyle = renderStyleId
    ? renderStyles.find((s) => s.id === renderStyleId) ?? null
    : null;
  const activeRenderStyleClass = activeRenderStyle?.cssClass ?? null;
  const activeRenderStyleRenderer = activeRenderStyle?.renderer;

  // ===== 持久化回调：本地立即更新 + 写回会话(已有会话时) =====
  const handleRenderStyleChange = (id: string) => {
    const next = id || null;
    setRenderStyleId(next);
    const convId = activeConvId;
    if (convId) {
      startModeTransition(async () => {
        try { await setConversationRenderStyle(convId, next); }
        catch (err) { console.error("set render style failed:", err); }
      });
    }
  };

  const handleOutputModeChange = (id: string) => {
    const next = id || null;
    setOutputModeId(next);
    const convId = activeConvId;
    if (convId) {
      startModeTransition(async () => {
        try { await setConversationOutputMode(convId, next); }
        catch (err) { console.error("set output mode failed:", err); }
      });
    }
  };

  const handleModelChange = (next: string) => {
    setModel(next);
    const convId = activeConvId;
    if (convId) {
      // 会话仍按 name 存库(share 快照等沿用 name);next 是 modelId,反查 name。
      const name = models.find((m) => m.modelId === next)?.name ?? next;
      startModeTransition(async () => {
        try { await setConversationModel(convId, name); }
        catch (err) { console.error("set model failed:", err); }
      });
    }
  };

  const handleWebSearchToggle = () => {
    const next = !webSearch;
    setWebSearch(next);
    const convId = activeConvId;
    if (convId) {
      startModeTransition(async () => {
        try { await setConversationWebSearch(convId, next); }
        catch (err) { console.error("set web search failed:", err); }
      });
    }
  };

  // 指令卡 / 知识库变化后,整体写回 composerState(已有会话时)
  const persistComposerState = (nextCards: string[], nextKbs: string[]) => {
    const convId = activeConvId;
    if (!convId) return;
    startModeTransition(async () => {
      try { await setConversationComposerState(convId, { cardIds: nextCards, kbIds: nextKbs }); }
      catch (err) { console.error("set composer state failed:", err); }
    });
  };

  // 指令卡 toggle(多选)
  const handleCardToggle = (id: string) => {
    setSelectedCardIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      persistComposerState(next, selectedKbIds);
      return next;
    });
  };

  // 知识库 toggle(多选)
  const handleKbToggle = (id: string) => {
    setSelectedKbIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      persistComposerState(selectedCardIds, next);
      return next;
    });
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

  return (
    <div className="flex-1 flex h-full bg-nebula-white dark:bg-twilight-obsidian transition-colors duration-250">
      {/* 主区:消息 + 输入(可被 artifact 面板挤压) */}
      <div className={clsx("relative flex flex-col h-full min-w-0 flex-1", activeArtifact && "lg:flex-[3] lg:border-r lg:border-morning-mist lg:dark:border-deep-space/80")}>
        {activeConvId && (
          <ChatHeader
            title={conversationTitle}
            conversationId={activeConvId}
            createShareAction={createShareAction}
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
          onEdit={(publicId, newContent, modelId) => {
            const name = models.find((m) => m.modelId === modelId)?.name ?? modelId;
            runtime.editAndResend(publicId, newContent, name, modelId);
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
            <ChatToolbar {...toolbarProps} />

            <ChatInputBox
              value={input}
              onChange={setInput}
              onSend={handleSend}
              disabled={runtime.streaming}
              onStop={runtime.stopGeneration}
              onPasteFiles={handleUpload}
              onDropFiles={handleUpload}
              cards={cards}
              onCardToggle={handleCardToggle}
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
