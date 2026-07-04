"use client";
import { useState, useEffect, useMemo, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Cpu } from "lucide-react";
import { clsx } from "clsx";
import { ArtifactPanel, type Artifact } from "@/features/artifacts/ArtifactPanel";
import FilePreviewModal, { type PreviewableFile } from "@/shared/components/file-preview/FilePreviewModal";
import { useChatRuntime } from "@/features/chat/hooks/useChatRuntime";
import { useChatAttachments } from "@/features/chat/hooks/useChatAttachments";
import { useChatScrollController } from "@/features/chat/hooks/useChatScrollController";
import { ChatMessageList } from "@/features/chat/components/ChatMessageList";
import { ChatToolbar } from "@/features/chat/components/ChatToolbar";
import { ChatInputBox } from "@/features/chat/components/ChatInputBox";
import { setConversationOutputMode, setConversationRenderStyle, setConversationModel, setConversationWebSearch, setConversationComposerState, setConversationModelParams } from "@/features/chat/actions/conversations";
import { estimateTokens } from "@/lib/tokens";
import type { ChatMessage, ModelOption, CardOption, KnowledgeBaseOption, OutputModeOption, RenderStyleOption } from "@/features/chat/model/types";

export type { ChatMessage, ModelOption, CardOption, KnowledgeBaseOption, OutputModeOption, RenderStyleOption } from "@/features/chat/model/types";

interface ChatComposerProps {
  models: ModelOption[];
  /** 可用的指令卡(空数组则不显示选择器)。 */
  cards?: CardOption[];
  /** 可用的知识库(空数组则不显示选择器)。 */
  knowledgeBases?: KnowledgeBaseOption[];
  /** 可用的输出方式(空数组则不显示选择器)。 */
  outputModes?: OutputModeOption[];
  /** 当前会话已选的输出方式 ID(undefined=新会话未选)。 */
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
  /** 当前会话模型参数(回填)。 */
  initialModelParams?: { temperature?: number | null; topP?: number | null; maxTokens?: number | null };
  /** 当前会话 ID(切换输出方式时持久化用;新会话无)。 */
  conversationId?: string;
  initialMessages?: ChatMessage[];
}

/**
 * ChatComposer —— 纯编排层。
 *
 * 持有所有会话级 selection state 与持久化逻辑，把渲染拆给三个子组件：
 *   - ChatMessageList：消息滚动区 + 空状态 + 对话大纲
 *   - ChatToolbar：模型/附件/4 个 picker/联网 toggle/chip 行
 *   - ChatInputBox：输入框 + 发送/停止 + token 计数
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
  initialModelParams,
  conversationId: initialConvId,
  initialMessages = [],
}: ChatComposerProps) {
  const t = useTranslations("chat");
  const [model, setModel] = useState(initialModelName && models.some((m) => m.name === initialModelName) ? initialModelName : (models[0]?.name ?? ""));
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

  const {
    attached,
    handleUpload,
    removeAttachment,
    uploadPending,
  } = useChatAttachments(initialConvId ?? null);
  const runtime = useChatRuntime({
    conversationId: initialConvId ?? null,
    initialMessages,
    uploadAttachments: uploadPending,
  });
  const { scrollRef, endRef: messagesEndRef, isAtBottom, onScroll, scrollToBottom, forceFollow } = useChatScrollController(runtime.messages);

  // 输入文本 + 图片附件的 token 估算(图片固定 255/张);非图片文件由后端解析,前端不计入
  const inputTokens = useMemo(() => {
    const textTokens = estimateTokens(input);
    const imageTokens = attached.filter((a) => a.isImage).length * 255;
    return textTokens + imageTokens;
  }, [input, attached]);

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
    runtime.send(input, model, selectedCardIds, webSearch, selectedKbIds, { outputModeId, renderStyleId });
    setInput("");
    // 用户主动发送:强制滚到底,确保自己的发言可见
    requestAnimationFrame(() => forceFollow());
  };

  // 空状态示例问题:填入输入框,用户可编辑后发送(不自动发送,保留修改空间)
  const handlePickSample = (text: string) => {
    setInput(text);
  };

  // 选中文本「引用」:以 Markdown 引用块插入输入框末尾
  const handleSelectionQuote = (text: string) => {
    setInput((prev) => (prev.trim() ? `${prev}\n\n> ${text}\n\n` : `> ${text}\n\n`));
  };
  // 选中文本「追问」:以选中文本为新问题直接发送(继续当前会话,不走分支)
  const handleSelectionAsk = (text: string) => {
    runtime.send(text, model, selectedCardIds, webSearch, selectedKbIds, { outputModeId, renderStyleId });
    requestAnimationFrame(() => forceFollow());
  };

  // 模型参数(temperature/topP/maxTokens):会话级持久化,null 表示用模型默认
  const [modelParams, setModelParams] = useState<{ temperature: number | null; topP: number | null; maxTokens: number | null }>({
    temperature: initialModelParams?.temperature ?? null,
    topP: initialModelParams?.topP ?? null,
    maxTokens: initialModelParams?.maxTokens ?? null,
  });
  const handleModelParamsChange = (p: { temperature?: number | null; topP?: number | null; maxTokens?: number | null }) => {
    setModelParams((prev) => ({
      temperature: p.temperature !== undefined ? p.temperature : prev.temperature,
      topP: p.topP !== undefined ? p.topP : prev.topP,
      maxTokens: p.maxTokens !== undefined ? p.maxTokens : prev.maxTokens,
    }));
    const convId = runtime.conversationId ?? initialConvId;
    if (convId) {
      startModeTransition(async () => {
        try { await setConversationModelParams(convId, p); }
        catch (err) { console.error("set model params failed:", err); }
      });
    }
  };
  const handleModelParamsReset = () => {
    setModelParams({ temperature: null, topP: null, maxTokens: null });
    const convId = runtime.conversationId ?? initialConvId;
    if (convId) {
      startModeTransition(async () => {
        try { await setConversationModelParams(convId, { temperature: null, topP: null, maxTokens: null }); }
        catch (err) { console.error("reset model params failed:", err); }
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
    const convId = runtime.conversationId ?? initialConvId;
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
    const convId = runtime.conversationId ?? initialConvId;
    if (convId) {
      startModeTransition(async () => {
        try { await setConversationOutputMode(convId, next); }
        catch (err) { console.error("set output mode failed:", err); }
      });
    }
  };

  const handleModelChange = (next: string) => {
    setModel(next);
    const convId = runtime.conversationId ?? initialConvId;
    if (convId) {
      startModeTransition(async () => {
        try { await setConversationModel(convId, next); }
        catch (err) { console.error("set model failed:", err); }
      });
    }
  };

  const handleWebSearchToggle = () => {
    const next = !webSearch;
    setWebSearch(next);
    const convId = runtime.conversationId ?? initialConvId;
    if (convId) {
      startModeTransition(async () => {
        try { await setConversationWebSearch(convId, next); }
        catch (err) { console.error("set web search failed:", err); }
      });
    }
  };

  // 指令卡 / 知识库变化后,整体写回 composerState(已有会话时)
  const persistComposerState = (nextCards: string[], nextKbs: string[]) => {
    const convId = runtime.conversationId ?? initialConvId;
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
          <h3 className="text-sm font-semibold">{t("noModels")}</h3>
          <p className="text-xs text-neutral-450 dark:text-neutral-500 leading-relaxed">
            {t("noModelsDesc")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex h-full bg-nebula-white dark:bg-twilight-obsidian transition-colors duration-250">
      {/* 主区:消息 + 输入(可被 artifact 面板挤压) */}
      <div className={clsx("relative flex flex-col h-full min-w-0 flex-1", activeArtifact && "lg:flex-[3] lg:border-r lg:border-morning-mist lg:dark:border-deep-space/80")}>
        <ChatMessageList
          messages={runtime.messages}
          streaming={runtime.streaming}
          scrollRef={scrollRef}
          messagesEndRef={messagesEndRef}
          isAtBottom={isAtBottom}
          onScroll={onScroll}
          scrollToBottom={scrollToBottom}
          model={model}
          renderStyleClass={activeRenderStyleClass}
          renderStyleRenderer={activeRenderStyleRenderer}
          onRegenerate={runtime.regenerate}
          onEdit={runtime.editAndResend}
          onSwitchVersion={runtime.switchVersion}
          onOpenArtifact={setActiveArtifact}
          onDelete={runtime.deleteMessage}
          onContinue={(id) => runtime.continueGeneration(id, model)}
          models={models}
          onPickSample={handlePickSample}
          onQuote={handleSelectionQuote}
          onAsk={handleSelectionAsk}
        />

        {/* Input Control Box */}
        <div className="border-t border-morning-mist dark:border-deep-space/80 p-4 md:p-6 bg-nebula-white dark:bg-twilight-obsidian sticky bottom-0 z-10">
          <div className="max-w-4xl mx-auto space-y-3.5">
            <ChatToolbar
              models={models}
              model={model}
              onModelChange={handleModelChange}
              attached={attached}
              onRemoveAttachment={removeAttachment}
              onPreviewFile={setPreviewFile}
              cards={cards}
              selectedCardIds={selectedCardIds}
              cardPickerOpen={cardPickerOpen}
              onCardPickerToggle={() => setCardPickerOpen((v) => !v)}
              onCardPickerClose={() => setCardPickerOpen(false)}
              onCardToggle={handleCardToggle}
              knowledgeBases={knowledgeBases}
              selectedKbIds={selectedKbIds}
              kbPickerOpen={kbPickerOpen}
              onKbPickerToggle={() => setKbPickerOpen((v) => !v)}
              onKbPickerClose={() => setKbPickerOpen(false)}
              onKbToggle={handleKbToggle}
              outputModes={outputModes}
              outputModeId={outputModeId}
              outputModePickerOpen={outputModePickerOpen}
              onOutputModePickerToggle={() => setOutputModePickerOpen((v) => !v)}
              onOutputModePickerClose={() => setOutputModePickerOpen(false)}
              onOutputModeToggle={handleOutputModeChange}
              onOutputModeClear={() => handleOutputModeChange("")}
              renderStyles={renderStyles}
              renderStyleId={renderStyleId}
              renderStylePickerOpen={renderStylePickerOpen}
              onRenderStylePickerToggle={() => setRenderStylePickerOpen((v) => !v)}
              onRenderStylePickerClose={() => setRenderStylePickerOpen(false)}
              onRenderStyleToggle={handleRenderStyleChange}
              onRenderStyleClear={() => handleRenderStyleChange("")}
              webSearch={webSearch}
              onWebSearchToggle={handleWebSearchToggle}
              modelParams={modelParams}
              onModelParamsChange={handleModelParamsChange}
              onModelParamsReset={handleModelParamsReset}
            />

            <ChatInputBox
              value={input}
              onChange={setInput}
              onSend={handleSend}
              disabled={runtime.streaming}
              onStop={runtime.stopGeneration}
              onPasteFiles={handleUpload}
              onDropFiles={handleUpload}
              tokenCount={inputTokens}
              cards={cards}
              onCardToggle={handleCardToggle}
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
