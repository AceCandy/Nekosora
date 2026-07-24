"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { MessageScroller, useMessageScroller } from "@shadcn/react/message-scroller";
import { ChevronDown, Copy, Reply, MessagesSquare, Volume2, Square } from "lucide-react";
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
  /** 当前会话 id:用于记忆/恢复滚动位置(切走再切回保持原位置)。 */
  conversationId?: string;
  /** 底部浮动输入区占用的留白(含间距),供消息区 padding-bottom 与"回到最新"按钮定位。 */
  bottomInset?: number;
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
  /** 选中文本「引用」：插入输入框。 */
  onQuote?: (text: string) => void;
  /** 选中文本「追问」：以该文本为新问题发送。 */
  onAsk?: (text: string) => void;
}

/** 划词朗读使用的固定 id:与消息朗读互斥,同一时刻只朗读一段。 */
const SELECTION_SPEECH_ID = "selection";

/** 锚定 user 消息到中上部时的顶部留白,与 message-scroller 的 scrollPreviousItemPeek 默认值对齐。 */
const ANCHOR_SCROLL_MARGIN = 64;

/**
 * 跨会话滚动位置记忆:按 conversationId 缓存 scrollTop。模块级(非 ref)以在
 * ChatMessageList 因会话切换重挂载时仍保持记忆。
 */
const scrollMemory = new Map<string, number>();

/**
 * 锚定信号消费者:须渲染在 MessageScroller.Provider 内。target 形如 `msg-{i}#{nonce}`。
 * - 检测到该轮 assistant 被 regenerate 清空为空占位后,锚定 user 到中上部(align:start + 64px 留白)。
 * - 一条独立的「到底跟随」规则:user 钉中上部后,监听其下方 assistant 流式增长,一旦撑满 user
 *   下方可见空间(即"到底"),转一次贴底跟随(scrollToEnd → following),之后由原语 autoScroll
 *   自动跟随后续流式输出。补齐 regenerate 原地替换无法走原语新增锚定路径的缺口。
 * target 带 nonce,保证同一轮反复重新生成也能重新触发。所有滚动都走原语方法,无 effect 内 setState。
 */
function ScrollAnchor({
  target,
  messages,
  streaming,
  viewportRef,
}: {
  target: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const { scrollToMessage, scrollToEnd } = useMessageScroller();
  const anchoredRef = useRef(false);
  const switchedRef = useRef(false);
  const msgId = target?.split("#")[0] ?? null;

  // target 变化(新一轮重新生成)时重置一次性标记
  useEffect(() => {
    anchoredRef.current = false;
    switchedRef.current = false;
  }, [target]);

  // 检测目标 assistant 被清空为空占位后,锚定 user 到中上部
  useEffect(() => {
    if (!msgId || anchoredRef.current) return;
    const uIdx = Number(msgId.slice(4));
    const next = messages[uIdx + 1];
    if (next?.role === "assistant" && !next.content && !next.reasoning) {
      scrollToMessage(msgId, { align: "start", behavior: "auto", scrollMargin: ANCHOR_SCROLL_MARGIN });
      anchoredRef.current = true;
    }
  }, [msgId, messages, scrollToMessage]);

  // 到底跟随:user 钉中上部(anchoredRef)后,下方 assistant 流式增长撑满可见空间则转贴底跟随
  useEffect(() => {
    if (!msgId || !streaming) return;
    const asstId = `msg-${Number(msgId.slice(4)) + 1}`;
    const check = () => {
      // 未锚定前跳过,避免 assistant 清空前旧内容的高度误触发贴底
      if (switchedRef.current || !anchoredRef.current) return;
      const userEl = document.getElementById(msgId);
      const asstEl = document.getElementById(asstId);
      const vp = viewportRef.current;
      if (!userEl || !asstEl || !vp) return;
      const userBottom = userEl.getBoundingClientRect().bottom;
      const asstHeight = asstEl.getBoundingClientRect().height;
      // assistant 高度填满 user 下方的可见空间即视为"到底",转贴底跟随
      if (asstHeight >= vp.clientHeight - userBottom) {
        scrollToEnd({ behavior: "auto" });
        switchedRef.current = true;
      }
    };
    const ro = new ResizeObserver(() => check());
    const asstEl = document.getElementById(asstId);
    if (asstEl) ro.observe(asstEl);
    check();
    return () => ro.disconnect();
  }, [msgId, streaming, viewportRef, scrollToEnd]);

  return null;
}

/**
 * 消息列表段 —— 基于 @shadcn/react/message-scroller 原语的滚动容器 + 消息渲染 + 对话大纲 + 回到最新。
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
  conversationId,
  bottomInset,
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
  // 重新生成是原地替换 assistant,不触发 scrollAnchor;记下目标 user 的 domId(带 nonce),交给
  // ScrollAnchor(Provider 内)在该轮 assistant 被清空后锚定到中上部,并接管独立的「到底跟随」。
  const [regenTarget, setRegenTarget] = useState<string | null>(null);
  const handleRegenerate = (publicId: string, model: string) => {
    // 被重新生成的是 assistant,向前找最近一条 user 消息,标记为锚定目标(nonce 保证同轮反复触发)
    const aIdx = messages.findIndex((m) => m.publicId === publicId);
    let uIdx = -1;
    for (let i = aIdx; i >= 0; i--) {
      if (messages[i].role === "user") { uIdx = i; break; }
    }
    if (uIdx >= 0) setRegenTarget(`msg-${uIdx}#${Date.now()}`);
    onRegenerate?.(publicId, model);
  };
  const handleEdit = (publicId: string, newContent: string, model: string) => {
    // 编辑的是 user 消息,直接锚定它到中上部(同重新生成机制);editAndResend 会截断到该 user
    // 并追加空 assistant,ScrollAnchor 据此锚定 + 接管到底跟随。
    const uIdx = messages.findIndex((m) => m.publicId === publicId);
    if (uIdx >= 0) setRegenTarget(`msg-${uIdx}#${Date.now()}`);
    onEdit?.(publicId, newContent, model);
  };
  // 视口 ref:供选区检测判断选区是否落在消息区内
  const viewportRef = useRef<HTMLDivElement>(null);

  // ===== 会话滚动位置记忆 =====
  // 关闭 message-scroller 的 autoScroll(其 following-bottom 模式会在 messages 变化时持续
  // scrollToEnd,覆盖恢复的位置),改为手动控制:切会话时 useLayoutEffect 在 fe 首次滚底后
  // 同步覆盖回记忆位置(无闪烁);流式时仅在用户已贴底时手动跟随(参考 GPT/Claude:用户在
  // 非底部看历史时不强制跟随)。restoredForConvRef 防止流式结束后重复恢复。
  const restoredForConvRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!conversationId || streaming) return;
    if (restoredForConvRef.current === conversationId) return;
    restoredForConvRef.current = conversationId;
    const saved = scrollMemory.get(conversationId);
    if (saved === undefined) return;
    const vp = viewportRef.current;
    if (vp) vp.scrollTop = saved;
  }, [conversationId, streaming]);
  // 流式时手动跟随底部(仅当用户已贴底);替代 autoScroll 的自动 scrollToEnd
  useEffect(() => {
    if (!streaming) return;
    const vp = viewportRef.current;
    if (!vp) return;
    const atBottom = vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 24;
    if (atBottom) vp.scrollTop = vp.scrollHeight;
  }, [messages, streaming]);
  const handleViewportScroll = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || !conversationId) return;
    scrollMemory.set(conversationId, vp.scrollTop);
  }, [conversationId]);
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
  return (
    <MessageScroller.Provider autoScroll={false} defaultScrollPosition="end" scrollEdgeThreshold={24}>
      {/* Root 即消息区外层容器,对话大纲/回到最新按钮锚定其内 */}
      <MessageScroller.Root className="relative flex-1 min-h-0 animate-in fade-in slide-in-from-bottom-2 duration-200">
        <MessageScroller.Viewport
          ref={viewportRef}
          onScroll={handleViewportScroll}
          className="scrollbar-hidden h-full overflow-y-auto px-6 pt-8 [overflow-anchor:none] md:pt-12"
          style={{ paddingBottom: bottomInset ?? 8 }}
          preserveScrollOnPrepend
        >
          <MessageScroller.Content className="mx-auto flex w-full max-w-3xl flex-col">
            {messages.map((m, i) => (
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
                    onRegenerate={handleRegenerate}
                    onEdit={handleEdit}
                    onSwitchVersion={onSwitchVersion}
                    onOpenArtifact={onOpenArtifact}
                    onRequestDelete={(pid) => setPendingDelete(pid)}
                    conversationStreaming={streaming}
                    onContinue={onContinue}
                    models={models}
                  />
                </ErrorBoundary>
              </MessageScroller.Item>
            ))}
          </MessageScroller.Content>
        </MessageScroller.Viewport>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 bg-gradient-to-b from-nebula-white via-nebula-white/70 to-transparent dark:from-twilight-obsidian dark:via-twilight-obsidian/70"
        />

        {/* 对话大纲:贴消息区右边缘(滚动条左侧),hover 整列弹出完整轮次列表。
            高亮/跳转由其内部 useMessageScrollerVisibility/useMessageScroller 承载(在 Provider 内)。 */}
        <ChatOutline messages={messages} streaming={streaming} />

        {/* 重新生成的锚定信号消费者(须在 Provider 内) */}
        <ScrollAnchor target={regenTarget} messages={messages} streaming={streaming} viewportRef={viewportRef} />

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
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-ui-caption font-semibold text-neutral-500 hover:text-neutral-800 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900 cursor-pointer"
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
                "inline-flex items-center gap-1 rounded px-2 py-1 text-ui-caption font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
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
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-ui-caption font-semibold text-neutral-500 hover:text-neutral-800 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900 cursor-pointer"
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
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-ui-caption font-semibold text-sora-blue hover:bg-sora-blue/[0.06] cursor-pointer"
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
          style={{ bottom: (bottomInset ?? 8) + 8 }}
          className="touch-target absolute left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 rounded-full border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink px-3 py-1.5 text-ui-caption font-semibold text-neutral-600 dark:text-neutral-300 shadow-sm hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-[background-color,opacity,transform] duration-300 ease-out data-[active=false]:pointer-events-none data-[active=false]:opacity-0 data-[active=false]:translate-y-4 data-[active=false]:scale-95 data-[active=true]:opacity-100 data-[active=true]:translate-y-0 data-[active=true]:scale-100"
        >
          <ChevronDown className="w-3.5 h-3.5 animate-[scroll-hint_1.6s_ease-in-out_infinite]" aria-hidden="true" />
          <span>{t("scrollToLatest")}</span>
        </MessageScroller.Button>
      </MessageScroller.Root>
    </MessageScroller.Provider>
  );
}
