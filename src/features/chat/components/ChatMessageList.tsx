"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageScroller } from "@shadcn/react/message-scroller";
import { Sparkles, ChevronDown, Copy, Reply, MessagesSquare, Volume2, Square } from "lucide-react";
import { clsx } from "clsx";
import { ChatMessageItem } from "@/features/chat/components/ChatMessageItem";
import { ChatOutline } from "@/features/chat/components/ChatOutline";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import type { ChatMessage, ModelOption } from "@/features/chat/model/types";
import type { Artifact } from "@/features/artifacts/ArtifactPanel";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { useMessageSpeech } from "@/features/chat/hooks/useMessageSpeech";

interface ChatMessageListProps {
  messages: ChatMessage[];
  streaming: boolean;
  /** 当前模型名（传给 ChatMessageItem 供 regenerate/edit 使用）。 */
  model: string;
  /** 当前会话选用的输出样式 cssClass（null=默认渲染）。 */
  renderStyleClass?: string | null;
  renderStyleRenderer?: "streamdown" | "custom";
  onRegenerate: (publicId: string, model: string) => void;
  onEdit?: (publicId: string, newContent: string, model: string) => void;
  onSwitchVersion?: (publicId: string, direction: "prev" | "next") => void;
  onOpenArtifact: (a: Artifact) => void;
  /** 软删除一条消息。 */
  onDelete?: (publicId: string) => void;
  /** 在 assistant 消息末尾续写。 */
  onContinue?: (publicId: string) => void;
  /** 可用模型列表(传给 ChatMessageItem 供重新生成换模型)。 */
  models?: ModelOption[];
  /** 空状态点击示例问题：填入输入框供用户编辑后发送。 */
  onPickSample?: (text: string) => void;
  /** 选中文本「引用」：插入输入框。 */
  onQuote?: (text: string) => void;
  /** 选中文本「追问」：以该文本为新问题发送。 */
  onAsk?: (text: string) => void;
}

/** 划词朗读使用的固定 id:与消息朗读互斥,同一时刻只朗读一段。 */
const SELECTION_SPEECH_ID = "selection";

/**
 * 消息列表段 —— 基于 @shadcn/react/message-scroller 原语的滚动容器 + 空状态 + 消息渲染 + 对话大纲 + 回到最新。
 *
 * 滚动行为(autoScroll 跟随流式 / scrollAnchor 锚定 user 消息到中上部 / 打开贴底 / 回到最新按钮)
 * 全部由 message-scroller 原语承载,不再手写控制器、不再虚拟滚动(见 design.md)。
 * 消息数组语义为「只追加 / 原地替换 / 末尾截断」,index 作为 key 在此场景功能正确
 * (publicId 延迟回填,改用 publicId 需 fallback 且无额外收益)。
 * 每条 ChatMessageItem 外包 ErrorBoundary,单条渲染崩溃不影响兄弟消息。
 */
export function ChatMessageList({
  messages,
  streaming,
  model,
  renderStyleClass,
  renderStyleRenderer,
  onRegenerate,
  onEdit,
  onSwitchVersion,
  onOpenArtifact,
  onDelete,
  onContinue,
  models,
  onPickSample,
  onQuote,
  onAsk,
}: ChatMessageListProps) {
  const t = useTranslations("chat");
  const { supported: ttsSupported, speakingId, speak, stop: stopSpeak } = useMessageSpeech();
  const isSelectionSpeaking = speakingId === SELECTION_SPEECH_ID;

  // 文本选区工具栏:选中消息正文时浮出复制 / 引用插入 / 追问
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  // 待确认删除的消息 publicId(user 消息):确认后连同其 AI 回复及后续整段子树一并删除
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  // 视口 ref:供选区检测判断选区是否落在消息区内
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const compute = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setSelection(null);
      const text = sel.toString().trim();
      if (!text) return setSelection(null);
      const range = sel.getRangeAt(0);
      if (!viewportRef.current?.contains(range.commonAncestorContainer)) return setSelection(null);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return setSelection(null);
      setSelection({ text, top: rect.top, left: rect.left + rect.width / 2 });
    };
    document.addEventListener("mouseup", compute);
    return () => document.removeEventListener("mouseup", compute);
  }, []);
  const rawSamples = t.raw("sampleQuestions");
  const samples: string[] = Array.isArray(rawSamples)
    ? rawSamples.filter((s): s is string => typeof s === "string" && s.trim() !== "")
    : [];

  return (
    <MessageScroller.Provider autoScroll defaultScrollPosition="end" scrollEdgeThreshold={24}>
      {/* Root 即消息区外层容器,对话大纲/回到最新按钮锚定其内 */}
      <MessageScroller.Root className="relative flex-1 min-h-0 animate-in fade-in slide-in-from-bottom-2 duration-200">
        <MessageScroller.Viewport
          ref={viewportRef}
          className="h-full overflow-y-auto px-6 pt-8 pb-2 md:pt-12 md:pb-3 [overflow-anchor:none]"
          preserveScrollOnPrepend
        >
          <MessageScroller.Content className="mx-auto w-full max-w-4xl flex flex-col">
            {messages.length === 0 ? (
              <WelcomeBlock samples={samples} onPickSample={onPickSample} />
            ) : (
              messages.map((m, i) => (
                // scrollAnchor 标在 user 消息:新轮锚定到该 user 消息(中上部),回复在其下方生长
                <MessageScroller.Item
                  key={i}
                  messageId={`msg-${i}`}
                  scrollAnchor={m.role === "user"}
                  className="py-4"
                >
                  <ErrorBoundary name="message">
                    <ChatMessageItem
                      domId={`msg-${i}`}
                      message={m}
                      isLast={i === messages.length - 1}
                      isStreaming={streaming}
                      model={model}
                      renderStyleClass={renderStyleClass}
                      renderStyleRenderer={renderStyleRenderer}
                      onRegenerate={onRegenerate}
                      onEdit={onEdit}
                      onSwitchVersion={onSwitchVersion}
                      onOpenArtifact={onOpenArtifact}
                      onRequestDelete={(pid) => setPendingDelete(pid)}
                      conversationStreaming={streaming}
                      onContinue={onContinue}
                      models={models}
                    />
                  </ErrorBoundary>
                </MessageScroller.Item>
              ))
            )}
          </MessageScroller.Content>
        </MessageScroller.Viewport>

        {/* 对话大纲:贴消息区右边缘(滚动条左侧),hover 整列弹出完整轮次列表。
            高亮/跳转由其内部 useMessageScrollerVisibility/useMessageScroller 承载(在 Provider 内)。 */}
        <ChatOutline messages={messages} streaming={streaming} />

        {/* 删除二次确认:删除用户消息会连带其 AI 回复及之后整段子树 */}
        <ConfirmDialog
          open={!!pendingDelete}
          onClose={() => setPendingDelete(null)}
          title={t("delete")}
          message={t("deleteCascadeNotice")}
          confirmLabel={t("delete")}
          danger
          onConfirm={() => {
            if (pendingDelete) onDelete?.(pendingDelete);
            setPendingDelete(null);
          }}
        />

        {/* 选中文本浮工具栏:复制 / 引用插入输入框 / 追问 */}
        {selection && (
          <div
            className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink px-1 py-0.5 shadow-md animate-in fade-in duration-100"
            style={{
              top: Math.max(8, selection.top - 38),
              left: Math.max(8, Math.min(selection.left - 100, (typeof window !== "undefined" ? window.innerWidth : 9999) - 210)),
            }}
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={async () => {
                await copyToClipboard(selection.text);
                setSelection(null);
                window.getSelection()?.removeAllRanges();
              }}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-neutral-500 hover:text-neutral-800 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900 cursor-pointer"
              title={t("copy")}
            >
              <Copy className="w-3 h-3" aria-hidden="true" />{t("copy")}
            </button>
            <button
              type="button"
              disabled={!ttsSupported}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (isSelectionSpeaking) {
                  stopSpeak();
                  setSelection(null);
                  window.getSelection()?.removeAllRanges();
                } else {
                  speak(SELECTION_SPEECH_ID, selection.text);
                }
              }}
              className={clsx(
                "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                isSelectionSpeaking
                  ? "text-sora-blue"
                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900",
              )}
              title={!ttsSupported ? t("readAloudUnsupported") : isSelectionSpeaking ? t("stopReading") : t("readAloud")}
            >
              {isSelectionSpeaking ? (
                <Square className="w-3 h-3" aria-hidden="true" />
              ) : (
                <Volume2 className="w-3 h-3" aria-hidden="true" />
              )}
              {isSelectionSpeaking ? t("stopReading") : t("readAloud")}
            </button>
            {onQuote && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onQuote(selection.text); setSelection(null); window.getSelection()?.removeAllRanges(); }}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-neutral-500 hover:text-neutral-800 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900 cursor-pointer"
                title={t("quote")}
              >
                <Reply className="w-3 h-3" aria-hidden="true" />{t("quote")}
              </button>
            )}
            {onAsk && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onAsk(selection.text); setSelection(null); window.getSelection()?.removeAllRanges(); }}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-sora-blue hover:bg-sora-blue/[0.06] cursor-pointer"
                title={t("askFollowup")}
              >
                <MessagesSquare className="w-3 h-3" aria-hidden="true" />{t("askFollowup")}
              </button>
            )}
          </div>
        )}

        {/* 回到最新:不在底部时浮出(message-scroller Button 据 data-active 控制显隐) */}
        <MessageScroller.Button
          direction="end"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 rounded-full border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink px-3 py-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300 shadow-sm hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors duration-150 data-[active=false]:pointer-events-none data-[active=false]:opacity-0 data-[active=true]:opacity-100"
        >
          <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t("scrollToLatest")}</span>
        </MessageScroller.Button>
      </MessageScroller.Root>
    </MessageScroller.Provider>
  );
}

/** 空会话欢迎屏：引导文案 + 可点击示例问题（点击填入输入框）。 */
function WelcomeBlock({
  samples,
  onPickSample,
}: {
  samples: string[];
  onPickSample?: (text: string) => void;
}) {
  const t = useTranslations("chat");
  return (
    <div className="text-center py-24 md:py-32 space-y-6 animate-in fade-in duration-300">
      <div className="w-12 h-12 rounded-full bg-sora-blue/[0.04] dark:bg-sora-blue/[0.02] border border-sora-blue/20 flex items-center justify-center mx-auto">
        <Sparkles className="w-5 h-5 text-sora-blue" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-base font-bold text-neutral-800 dark:text-white">{t("welcomeTitle")}</h2>
        <p className="text-xs text-neutral-450 dark:text-neutral-500 max-w-[280px] mx-auto leading-relaxed">
          {t("welcomeDesc")}
        </p>
      </div>
      {samples.length > 0 && (
        <div className="max-w-xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
          {samples.map((q, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPickSample?.(q)}
              className="rounded-lg border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink px-3.5 py-2.5 text-xs text-neutral-600 dark:text-neutral-300 hover:border-sora-blue dark:hover:border-sora-blue hover:text-neutral-900 dark:hover:text-white hover:shadow-sm transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
