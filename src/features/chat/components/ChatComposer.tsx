"use client";
import { useState, useEffect, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Send, Paperclip, Loader2, Sparkles, Cpu, X, Globe, Library, Wand2, Palette } from "lucide-react";
import { clsx } from "clsx";
import { ArtifactPanel, type Artifact } from "@/features/artifacts/ArtifactPanel";
import FilePreviewModal, { type PreviewableFile } from "@/shared/components/file-preview/FilePreviewModal";
import { useChatRuntime } from "@/features/chat/hooks/useChatRuntime";
import { useChatAttachments } from "@/features/chat/hooks/useChatAttachments";
import { useChatScrollController } from "@/features/chat/hooks/useChatScrollController";
import { setConversationOutputMode, setConversationRenderStyle, setConversationModel, setConversationWebSearch, setConversationComposerState } from "@/features/chat/actions/conversations";
import type { ChatMessage, ModelOption, CardOption, KnowledgeBaseOption, OutputModeOption, RenderStyleOption } from "@/features/chat/model/types";
import { ChatMessageItem } from "./ChatMessageItem";

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
  /** 当前会话 ID(切换输出方式时持久化用;新会话无)。 */
  conversationId?: string;
  initialMessages?: ChatMessage[];
}

/**
 * ChatComposer —— 纯编排 + 渲染层。
 *
 * 业务逻辑已抽离到三个 hook。
 * 此处使用 React.memo 优化的 ChatMessageItem 渲染消息以极大提升 streaming 性能。
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
  conversationId: initialConvId,
  initialMessages = [],
}: ChatComposerProps) {
  // 内部 state 存 name(对外 ID),保证 API 调用稳定;UI 渲染时再映射到 displayName
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
    fileInputRef,
    handleUpload,
    removeAttachment,
    uploadPending,
  } = useChatAttachments(initialConvId ?? null);
  const runtime = useChatRuntime({
    conversationId: initialConvId ?? null,
    initialMessages,
    uploadAttachments: uploadPending,
  });
  const messagesEndRef = useChatScrollController(runtime.messages);

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
  };

  // 切换输出样式:本地立即更新 + 持久化到会话(已有会话时)
  const handleRenderStyleChange = (id: string) => {
    const next = id || null;
    setRenderStyleId(next);
    const convId = runtime.conversationId ?? initialConvId;
    if (convId) {
      startModeTransition(async () => {
        try {
          await setConversationRenderStyle(convId, next);
        } catch (err) {
          console.error("set render style failed:", err);
        }
      });
    }
  };

  // 当前选中的样式 cssClass(供 ChatMessageItem 套容器 class),null 表示用默认渲染
  const activeRenderStyle = renderStyleId
    ? renderStyles.find((s) => s.id === renderStyleId) ?? null
    : null;
  const activeRenderStyleClass = activeRenderStyle?.cssClass ?? null;
  const activeRenderStyleRenderer = activeRenderStyle?.renderer;

  // 切换输出方式:本地立即更新 + 持久化到会话(已有会话时)
  const handleOutputModeChange = (id: string) => {
    const next = id || null;
    setOutputModeId(next);
    const convId = runtime.conversationId ?? initialConvId;
    if (convId) {
      startModeTransition(async () => {
        try {
          await setConversationOutputMode(convId, next);
        } catch (err) {
          console.error("set output mode failed:", err);
        }
      });
    }
  };

  // 切换模型:本地立即更新 + 持久化到会话(已有会话时)
  const handleModelChange = (next: string) => {
    setModel(next);
    const convId = runtime.conversationId ?? initialConvId;
    if (convId) {
      startModeTransition(async () => {
        try {
          await setConversationModel(convId, next);
        } catch (err) {
          console.error("set model failed:", err);
        }
      });
    }
  };

  // 切换联网:本地立即更新 + 持久化到会话(已有会话时)
  const handleWebSearchToggle = () => {
    const next = !webSearch;
    setWebSearch(next);
    const convId = runtime.conversationId ?? initialConvId;
    if (convId) {
      startModeTransition(async () => {
        try {
          await setConversationWebSearch(convId, next);
        } catch (err) {
          console.error("set web search failed:", err);
        }
      });
    }
  };

  // 指令卡 / 知识库变化后,整体写回 composerState(已有会话时)
  const persistComposerState = (nextCards: string[], nextKbs: string[]) => {
    const convId = runtime.conversationId ?? initialConvId;
    if (!convId) return;
    startModeTransition(async () => {
      try {
        await setConversationComposerState(convId, { cardIds: nextCards, kbIds: nextKbs });
      } catch (err) {
        console.error("set composer state failed:", err);
      }
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
      <div className={clsx("flex flex-col h-full min-w-0 flex-1", activeArtifact && "lg:flex-[3] lg:border-r lg:border-morning-mist lg:dark:border-deep-space/80")}>
        {/* Messages Scroll Area */}
        <div className="flex-1 overflow-y-auto px-6 py-8 md:py-12">
          <div className="max-w-4xl mx-auto space-y-8">
            {runtime.messages.length === 0 && (
              <div className="text-center py-24 md:py-32 space-y-4 animate-in fade-in duration-300">
                <div className="w-12 h-12 rounded-full bg-sora-blue/[0.04] dark:bg-sora-blue/[0.02] border border-sora-blue/20 flex items-center justify-center mx-auto">
                  <Sparkles className="w-5 h-5 text-sora-blue" aria-hidden="true" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-base font-bold text-neutral-800 dark:text-white">{t("welcomeTitle")}</h2>
                  <p className="text-xs text-neutral-450 dark:text-neutral-500 max-w-[280px] mx-auto leading-relaxed">
                    {t("welcomeDesc")}
                  </p>
                </div>
              </div>
            )}

            {runtime.messages.map((m, i) => (
              <ChatMessageItem
                key={i}
                message={m}
                isLast={i === runtime.messages.length - 1}
                isStreaming={runtime.streaming}
                model={model}
                renderStyleClass={activeRenderStyleClass}
                renderStyleRenderer={activeRenderStyleRenderer}
                onRegenerate={runtime.regenerate}
                onEdit={runtime.editAndResend}
                onSwitchVersion={runtime.switchVersion}
                onOpenArtifact={setActiveArtifact}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Control Box */}
        <div className="border-t border-morning-mist dark:border-deep-space/80 p-4 md:p-6 bg-nebula-white dark:bg-twilight-obsidian sticky bottom-0 z-10">
          <div className="max-w-4xl mx-auto space-y-3.5">
            {/* File Attachments & Model Selector */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <select
                value={model}
                onChange={(e) => handleModelChange(e.target.value)}
                className="rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink px-3 py-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-200 focus:outline-none focus:border-sora-blue dark:focus:border-sora-blue transition-colors cursor-pointer"
                aria-label="选择对话模型"
              >
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.displayName ?? m.name}
                  </option>
                ))}
              </select>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={(e) => handleUpload(e.target.files)}
                className="hidden"
                id="file-upload"
                aria-label="上传附件"
              />

              <label
                htmlFor="file-upload"
                className="inline-flex items-center gap-1 rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink px-3 py-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
                title={t("uploadAttachment")}
              >
                <Paperclip className="w-3.5 h-3.5 text-neutral-400" aria-hidden="true" />
                <span>{t("uploadAttachment")}</span>
              </label>

              {/* 指令卡选择器 */}
              {cards.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCardPickerOpen((v) => !v)}
                    className={clsx(
                      "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue",
                      selectedCardIds.length > 0
                        ? "border-sora-blue/30 bg-sora-blue/[0.04] text-sora-blue"
                        : "border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
                    )}
                    title={t("instructionCard")}
                    aria-haspopup="listbox"
                    aria-expanded={cardPickerOpen}
                    aria-label="选择指令卡"
                  >
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{t("instructionCard")}{selectedCardIds.length > 0 ? ` (${selectedCardIds.length})` : ""}</span>
                  </button>

                  {cardPickerOpen && (
                    <>
                      {/* 点击外部关闭 */}
                      <div className="fixed inset-0 z-20" onClick={() => setCardPickerOpen(false)} aria-hidden="true" />
                      <div className="absolute z-30 mt-1 w-64 max-h-72 overflow-y-auto rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink shadow-lg p-1">
                        {cards.map((c) => {
                          const checked = selectedCardIds.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() =>
                                setSelectedCardIds((prev) => {
                                  const next = checked ? prev.filter((id) => id !== c.id) : [...prev, c.id];
                                  persistComposerState(next, selectedKbIds);
                                  return next;
                                })
                              }
                              className={clsx(
                                "w-full text-left rounded px-2 py-1.5 text-xs transition-colors flex items-start gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue",
                                checked
                                  ? "bg-sora-blue/[0.06] text-sora-blue"
                                  : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
                              )}
                            >
                              <span className={clsx("mt-0.5 shrink-0", checked ? "opacity-100" : "opacity-30")} aria-hidden="true">
                                {checked ? "✓" : "○"}
                              </span>
                              <span className="min-w-0">
                                <span className="font-semibold block truncate">{c.title}</span>
                                <span className="text-[10px] text-neutral-400 font-mono">/{c.trigger}</span>
                                {c.description && (
                                  <span className="text-[10px] text-neutral-400 block truncate">{c.description}</span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* 联网搜索 toggle */}
              <button
                type="button"
                onClick={handleWebSearchToggle}
                className={clsx(
                  "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer",
                  webSearch
                    ? "border-sora-blue/30 bg-sora-blue/[0.04] text-sora-blue"
                    : "border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
                )}
                title={t("webSearch")}
                aria-pressed={webSearch}
                aria-label={t("webSearch")}
              >
                <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t("webSearch")}</span>
              </button>

              {/* 知识库选择器 */}
              {knowledgeBases.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setKbPickerOpen((v) => !v)}
                    className={clsx(
                      "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer",
                      selectedKbIds.length > 0
                        ? "border-sora-blue/30 bg-sora-blue/[0.04] text-sora-blue"
                        : "border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
                    )}
                    title={t("knowledgeBase")}
                    aria-haspopup="listbox"
                    aria-expanded={kbPickerOpen}
                    aria-label={t("knowledgeBase")}
                  >
                    <Library className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{t("knowledgeBase")}{selectedKbIds.length > 0 ? ` (${selectedKbIds.length})` : ""}</span>
                  </button>
                  {kbPickerOpen && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setKbPickerOpen(false)} aria-hidden="true" />
                      <div className="absolute z-30 mt-1 w-64 max-h-72 overflow-y-auto rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink shadow-lg p-1">
                        {knowledgeBases.map((kb) => {
                          const checked = selectedKbIds.includes(kb.id);
                          return (
                            <button
                              key={kb.id}
                              type="button"
                              onClick={() =>
                                setSelectedKbIds((prev) => {
                                  const next = checked ? prev.filter((id) => id !== kb.id) : [...prev, kb.id];
                                  persistComposerState(selectedCardIds, next);
                                  return next;
                                })
                              }
                              className={clsx(
                                "w-full text-left rounded px-2 py-1.5 text-xs transition-colors flex items-start gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer",
                                checked
                                  ? "bg-sora-blue/[0.06] text-sora-blue"
                                  : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
                              )}
                            >
                              <span className={clsx("mt-0.5 shrink-0", checked ? "opacity-100" : "opacity-30")} aria-hidden="true">
                                {checked ? "✓" : "○"}
                              </span>
                              <span className="min-w-0">
                                <span className="font-semibold block truncate">{kb.name}</span>
                                <span className="text-[10px] text-neutral-400">{kb.fileCount} 文件</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* 输出方式(会话级,写入会话记忆) */}
              {outputModes.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOutputModePickerOpen((v) => !v)}
                    className={clsx(
                      "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer",
                      outputModeId
                        ? "border-transparent bg-sora-blue/[0.04] text-sora-blue hover:bg-sora-blue/[0.08]"
                        : "border-transparent bg-transparent text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
                    )}
                    title={t("outputMode")}
                    aria-haspopup="listbox"
                    aria-expanded={outputModePickerOpen}
                    aria-label={t("outputMode")}
                  >
                    <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {outputModeId
                        ? (outputModes.find((m) => m.id === outputModeId)?.name ?? t("outputMode"))
                        : t("outputMode")}
                    </span>
                  </button>

                  {outputModePickerOpen && (
                    <>
                      {/* 点击外部关闭 */}
                      <div
                        className="fixed inset-0 z-20"
                        onClick={() => setOutputModePickerOpen(false)}
                        aria-hidden="true"
                      />
                      <div className="absolute z-30 mt-1 w-64 max-h-72 overflow-y-auto rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink shadow-lg p-1">
                        {outputModes.map((m) => {
                          const isSelected = outputModeId === m.id;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => {
                                handleOutputModeChange(isSelected ? "" : m.id);
                                setOutputModePickerOpen(false);
                              }}
                              className={clsx(
                                "w-full text-left rounded px-2 py-1.5 text-xs transition-colors flex items-start gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer",
                                isSelected
                                  ? "bg-sora-blue/[0.06] text-sora-blue"
                                  : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
                              )}
                            >
                              <span className={clsx("mt-0.5 shrink-0", isSelected ? "opacity-100" : "opacity-30")} aria-hidden="true">
                                {isSelected ? "✓" : "○"}
                              </span>
                              <span className="min-w-0">
                                <span className="font-semibold block truncate">{m.name}</span>
                                {m.description && (
                                  <span className="text-[10px] text-neutral-400 block truncate">{m.description}</span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* 输出样式(会话级,写入会话记忆) */}
              {renderStyles.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setRenderStylePickerOpen((v) => !v)}
                    className={clsx(
                      "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer",
                      renderStyleId
                        ? "border-transparent bg-sora-blue/[0.04] text-sora-blue hover:bg-sora-blue/[0.08]"
                        : "border-transparent bg-transparent text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
                    )}
                    title={t("renderStyle")}
                    aria-haspopup="listbox"
                    aria-expanded={renderStylePickerOpen}
                    aria-label={t("renderStyle")}
                  >
                    <Palette className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {renderStyleId
                        ? (renderStyles.find((s) => s.id === renderStyleId)?.name ?? t("renderStyle"))
                        : t("renderStyle")}
                    </span>
                  </button>

                  {renderStylePickerOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-20"
                        onClick={() => setRenderStylePickerOpen(false)}
                        aria-hidden="true"
                      />
                      <div className="absolute z-30 mt-1 w-64 max-h-72 overflow-y-auto rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink shadow-lg p-1">
                        {renderStyles.map((s) => {
                          const isSelected = renderStyleId === s.id;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                handleRenderStyleChange(isSelected ? "" : s.id);
                                setRenderStylePickerOpen(false);
                              }}
                              className={clsx(
                                "w-full text-left rounded px-2 py-1.5 text-xs transition-colors flex items-start gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer",
                                isSelected
                                  ? "bg-sora-blue/[0.06] text-sora-blue"
                                  : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
                              )}
                            >
                              <span className={clsx("mt-0.5 shrink-0", isSelected ? "opacity-100" : "opacity-30")} aria-hidden="true">
                                {isSelected ? "✓" : "○"}
                              </span>
                              <span className="min-w-0">
                                <span className="font-semibold block truncate">{s.name}</span>
                                {s.description && (
                                  <span className="text-[10px] text-neutral-400 block truncate">{s.description}</span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* 已选指令卡 chip */}
              {selectedCardIds.map((id) => {
                const card = cards.find((c) => c.id === id);
                if (!card) return null;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-sora-blue/20 bg-sora-blue/[0.04] px-2.5 py-1 text-[11px] font-medium text-sora-blue"
                  >
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="max-w-[100px] truncate">{card.title}</span>
                    <button
                      onClick={() =>
                        setSelectedCardIds((prev) => {
                          const next = prev.filter((x) => x !== id);
                          persistComposerState(next, selectedKbIds);
                          return next;
                        })
                      }
                      className="hover:opacity-75 p-1.5 -m-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sora-blue rounded-full cursor-pointer"
                      title={t("attachRemove")}
                      aria-label="移除指令卡"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </span>
                );
              })}

              {attached.map((a) => {
                const isPreviewable = a.status === "uploaded" && a.fileId;
                return (
                  <span
                    key={a.id}
                    className={clsx(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                      a.status === "uploaded" && "bg-sora-blue/[0.04] border-sora-blue/20 text-sora-blue",
                      a.status === "uploading" && "bg-neutral-100 dark:bg-neutral-900 border-morning-mist dark:border-deep-space text-neutral-500",
                      a.status === "pending" && "bg-neku-amber/[0.04] border-neku-amber/20 text-neku-amber",
                      a.status === "error" && "bg-red-500/[0.04] border-red-500/20 text-red-500"
                    )}
                  >
                    <button
                      type="button"
                      disabled={!isPreviewable}
                      onClick={() => isPreviewable && setPreviewFile({ fileId: a.fileId!, filename: a.filename, mime: guessMime(a.filename) })}
                      className="inline-flex items-center gap-1.5 disabled:cursor-default enabled:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue rounded"
                      title={isPreviewable ? t("attachPreview") : undefined}
                    >
                      {a.status === "uploading" ? (
                        <Loader2 className="w-3.5 h-3.5 text-neutral-400 animate-spin" aria-hidden="true" />
                      ) : a.isImage && a.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={a.previewUrl}
                          alt={a.filename}
                          className="w-4 h-4 rounded-sm object-cover shrink-0"
                        />
                      ) : (
                        <Paperclip className={clsx(
                          "w-3 h-3",
                          a.status === "uploaded" && "text-sora-blue",
                          a.status === "pending" && "text-neku-amber",
                          a.status === "error" && "text-red-500"
                        )} aria-hidden="true" />
                      )}

                      <span className="max-w-[120px] truncate" title={a.filename}>
                        {a.filename}
                        {a.status === "pending" && ` ${t("attachPending")}`}
                        {a.status === "uploading" && ` ${t("attachUploading")}`}
                        {a.status === "error" && ` ${t("attachError")}`}
                      </span>
                    </button>

                    <button
                      onClick={() => removeAttachment(a.id)}
                      className="hover:opacity-75 font-semibold p-1.5 -m-1 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-850 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sora-blue cursor-pointer"
                      title={t("attachRemove")}
                      aria-label="移除附件"
                    >
                      <X className="w-3.5 h-3.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300" aria-hidden="true" />
                    </button>
                  </span>
                );
              })}
            </div>

            {/* Prompt input field */}
            <div className="flex gap-3 items-end bg-white dark:bg-space-ink border border-morning-mist dark:border-deep-space rounded-lg p-2.5 focus-within:border-sora-blue dark:focus-within:border-sora-blue transition-all duration-150">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={(e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  const imageFiles: File[] = [];
                  for (const item of items) {
                    if (item.kind === "file" && item.type.startsWith("image/")) {
                      const f = item.getAsFile();
                      if (f) imageFiles.push(f);
                    }
                  }
                  if (imageFiles.length > 0) {
                    e.preventDefault();
                    handleUpload(imageFiles);
                  }
                }}
                onDrop={(e) => {
                  const dropped = e.dataTransfer?.files;
                  if (dropped && dropped.length > 0) {
                    e.preventDefault();
                    handleUpload(dropped);
                  }
                }}
                onDragOver={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={t("placeholder")}
                rows={2}
                className="flex-1 bg-transparent border-0 outline-none text-sm resize-none focus:ring-0 text-neutral-800 dark:text-neutral-200 py-1.5 px-2.5 leading-relaxed placeholder-neutral-400"
                disabled={runtime.streaming}
                aria-label="对话输入框"
              />

              {runtime.streaming ? (
                <button
                  onClick={runtime.stopGeneration}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-red-500 hover:bg-red-600 text-white hover:shadow-[0_4px_12px_rgba(239,68,68,0.15)] transition-all duration-200 shrink-0 shadow-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  title={t("stopGeneration")}
                  aria-label={t("stopGeneration")}
                >
                  <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="5" y="5" width="14" height="14" rx="1" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-sora-blue hover:bg-sora-blue-hover text-white hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] disabled:opacity-40 disabled:hover:shadow-none transition-all duration-200 shrink-0 shadow-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
                  title={t("send")}
                  aria-label={t("send")}
                >
                  <Send className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
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

/** 按扩展名粗略推断 mime */
function guessMime(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
    mp4: "video/mp4", webm: "video/webm",
    txt: "text/plain", md: "text/markdown",
    json: "application/json", xml: "application/xml",
    js: "text/javascript", ts: "text/typescript", tsx: "text/typescript",
    py: "text/x-python", go: "text/x-go", rs: "text/rust",
    html: "text/html", css: "text/css",
    yaml: "application/x-yaml", yml: "application/x-yaml",
    csv: "text/csv",
  };
  return map[ext] ?? "application/octet-stream";
}
