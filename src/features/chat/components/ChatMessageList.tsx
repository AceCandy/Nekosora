"use client";

import React, { useEffect, useState, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
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
  /** 滚动容器 ref（由 useChatScrollController 提供）。 */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** 底部锚点 ref（流式时撑高 h-32 作为缓冲与滚动锚）。 */
  messagesEndRef: RefObject<HTMLDivElement | null>;
  /** 距底 ≤ 1/3 视口高视为「在最新附近」;回到最新按钮据此显隐。 */
  isNearBottom: boolean;
  /** 挂载贴底收敛前为 false(消息区 opacity-0 隐藏测量追赶),收敛后 true 触发淡入显形。 */
  ready: boolean;
  onScroll: () => void;
  scrollToBottom: () => void;
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
 * 消息列表段 —— 滚动容器 + 空状态 + 消息渲染 + 对话大纲 + 回到底部按钮。
 *
 * 从 ChatComposer 抽出，纯展示：所有状态由父组件（ChatComposer）受控下传。
 * 消息数组语义为「只追加 / 原地替换 / 末尾截断」，故 index 作为 key 在此场景功能正确
 * （publicId 延迟回填，改用 publicId 需 fallback 且无额外收益）。
 * 每条 ChatMessageItem 外包 ErrorBoundary，单条渲染崩溃不影响兄弟消息。
 */
export function ChatMessageList({
  messages,
  streaming,
  scrollRef,
  messagesEndRef,
  isNearBottom,
  ready,
  onScroll,
  scrollToBottom,
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
  useEffect(() => {
    const compute = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setSelection(null);
      const text = sel.toString().trim();
      if (!text) return setSelection(null);
      const range = sel.getRangeAt(0);
      if (!scrollRef.current?.contains(range.commonAncestorContainer)) return setSelection(null);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return setSelection(null);
      setSelection({ text, top: rect.top, left: rect.left + rect.width / 2 });
    };
    document.addEventListener("mouseup", compute);
    return () => document.removeEventListener("mouseup", compute);
  }, [scrollRef]);
  const rawSamples = t.raw("sampleQuestions");
  const samples: string[] = Array.isArray(rawSamples)
    ? rawSamples.filter((s): s is string => typeof s === "string" && s.trim() !== "")
    : [];

  // 虚拟滚动:仅渲染可见消息项 + overscan 缓冲,解决长会话卡顿;measureElement 动态测量每项实际高度。
  // useChatScrollController 基于 scrollHeight,虚拟化撑高 div 后仍正确,贴底/跟随/平滑滚动逻辑不变。
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 200,
    overscan: 4,
  });

  // 当前视口顶部对应的 msg index(首个底边越过 scrollTop 的可见项),供对话大纲高亮「当前轮次」
  const visItems = rowVirtualizer.getVirtualItems();
  let activeMessageIndex = -1;
  if (visItems.length > 0) {
    const top = scrollRef.current?.scrollTop ?? 0;
    activeMessageIndex = visItems.find((vi) => vi.start + vi.size >= top)?.index ?? visItems[visItems.length - 1].index;
  }

  return (
    // 相对外层 relative 容器,让对话大纲/回到最新按钮锚定在消息区(而非含输入框的主区)。
    // ready(hide-until-settled):贴底未收敛前 opacity-0 隐藏测量追赶,收敛后挂 animate-in 淡入显形。
    <div className={clsx("relative flex-1 min-h-0", ready ? "animate-in fade-in slide-in-from-bottom-2 duration-200" : "opacity-0")}>
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-6 py-8 md:py-12">
        {messages.length === 0 ? (
          <div className="max-w-4xl mx-auto">
            <WelcomeBlock samples={samples} onPickSample={onPickSample} />
          </div>
        ) : (
          <div
            style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const m = messages[vi.index];
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={rowVirtualizer.measureElement}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  <div className="max-w-4xl mx-auto py-4">
                    <ErrorBoundary name="message">
                      <ChatMessageItem
                        domId={`msg-${vi.index}`}
                        message={m}
                        isLast={vi.index === messages.length - 1}
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
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {/* 底部留白缓冲:仅流式生成时撑高约 2/3 屏,让生成内容停在视口上部、下方留白;同时作为滚动锚点 */}
        <div ref={messagesEndRef} className={streaming ? "h-2/3" : "h-0"} />
      </div>

      {/* 对话大纲:贴消息区右边缘(滚动条左侧),hover 整列弹出完整轮次列表 */}
      <ChatOutline messages={messages} streaming={streaming} activeMessageIndex={activeMessageIndex} />

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

      {/* 跳到最新:上滑超过 1/3 视口高时浮出;在最新附近(≤1/3 屏)隐藏 */}
      {!isNearBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 rounded-full border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink px-3 py-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300 shadow-sm hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors duration-150"
          title={t("scrollToLatest")}
          aria-label={t("scrollToLatest")}
        >
          <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t("scrollToLatest")}</span>
        </button>
      )}
    </div>
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
