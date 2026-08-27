"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslations } from "next-intl";
import {
  MessageScroller,
  useMessageScroller,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller";
import { ChevronDown, Reply, MessagesSquare, Volume2, Square } from "lucide-react";
import { AICopyIcon } from "@/shared/components/animated-icons";
import { clsx } from "clsx";
import { ChatMessageItem } from "@/features/chat/components/ChatMessageItem";
import { ChatOutline } from "@/features/chat/components/ChatOutline";
import { MessageTimeSeparator } from "@/features/chat/components/MessageTimeSeparator";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import type { ChatMessage, MessageFeedback, ModelOption } from "@/features/chat/model/types";
import type { Artifact } from "@/features/artifacts/ArtifactPanel";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { useMessageSpeech } from "@/features/chat/hooks/useMessageSpeech";
import {
  CHAT_SCROLL_EDGE_THRESHOLD,
  captureChatScrollMemory,
  resolveChatScrollEntry,
  type ChatScrollMemoryEntry,
} from "@/features/chat/model/chatScrollMemory";
import {
  applyRenderStyleBatch,
  resolveRenderStyle,
  resolveViewportAnchorDelta,
  sameRenderStyle,
  settleRenderStyleRollout,
  startRenderStyleRollout,
  type RenderStyleRollout,
  type RenderStyleSemantics,
} from "@/features/chat/model/progressiveRenderStyle";

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
  /** 是否使用内置纸面样式（仅影响 assistant 的代码块表现）。 */
  isPaper?: boolean;
  onRegenerate: (publicId: string, model: string) => void;
  onEdit?: (publicId: string, newContent: string, attachmentFileIds: string[], model: string) => void;
  onSwitchVersion?: (publicId: string, direction: "prev" | "next") => void;
  onOpenArtifact: (a: Artifact) => void;
  /** 软删除一条消息。 */
  onDelete?: (publicId: string) => void;
  /** 在 assistant 消息末尾续写。 */
  onContinue?: (publicId: string) => void;
  /** 反馈乐观结果同步到 store。 */
  onFeedbackChange?: (publicId: string, feedback: MessageFeedback | undefined) => void;
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

/** 每帧只切少量历史回复，避免一次提交重建整段 custom/streamdown DOM。 */
const RENDER_STYLE_BATCH_SIZE = 4;

/**
 * 跨会话滚动位置记忆:按 conversationId 缓存 scrollTop 与是否在底部。模块级(非 ref)
 * 以在 ChatMessageList 因会话切换重挂载时仍保持记忆。
 */
const scrollMemory = new Map<string, ChatScrollMemoryEntry>();

interface ScrollPositionRestorerHandle {
  followEnd: () => void;
  restore: (scrollTop: number) => void;
}

interface ScrollPositionRestorerProps {
  viewportRef: RefObject<HTMLDivElement | null>;
}

/** 将 message-scroller 切到自由滚动后,恢复保存的像素位置。 */
const ScrollPositionRestorer = forwardRef<ScrollPositionRestorerHandle, ScrollPositionRestorerProps>(
  function ScrollPositionRestorer({ viewportRef }, ref) {
    const { scrollToEnd, scrollToStart } = useMessageScroller();

    useImperativeHandle(ref, () => ({
      followEnd: () => {
        scrollToEnd({ behavior: "auto" });
      },
      restore: (scrollTop) => {
        if (!scrollToStart({ behavior: "auto" })) return;
        const viewport = viewportRef.current;
        if (viewport) viewport.scrollTop = scrollTop;
      },
    }), [scrollToEnd, scrollToStart, viewportRef]);

    return null;
  },
);

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

interface ProgressiveRenderStyleProps {
  messages: ChatMessage[];
  conversationId?: string;
  cssClass?: string | null;
  renderer?: "streamdown" | "custom";
  isPaper?: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
  children: (resolve: (index: number) => RenderStyleSemantics) => ReactNode;
}

interface RenderStyleViewportAnchor {
  generation: number;
  messageId: string;
  scrollTop: number;
  viewportTop: number;
}

/** 在 MessageScroller.Provider 内按可见优先、屏外分批推进 renderer。 */
function ProgressiveRenderStyle({
  messages,
  conversationId,
  cssClass,
  renderer,
  isPaper,
  viewportRef,
  children,
}: ProgressiveRenderStyleProps) {
  const { visibleMessageIds } = useMessageScrollerVisibility();
  const target = useMemo<RenderStyleSemantics>(
    () => ({ cssClass, renderer, isPaper }),
    [cssClass, renderer, isPaper],
  );
  const [rollout, setRollout] = useState<RenderStyleRollout>(() => ({
    conversationId,
    target,
    applied: null,
    generation: 0,
  }));
  const messagesRef = useRef(messages);
  const visibleIdsRef = useRef(visibleMessageIds);
  const previousTargetRef = useRef(target);
  const previousConversationIdRef = useRef(conversationId);
  const generationRef = useRef(0);
  const rolloutActiveRef = useRef(false);
  const viewportAnchorRef = useRef<RenderStyleViewportAnchor | null>(null);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    visibleIdsRef.current = visibleMessageIds;
  }, [visibleMessageIds]);

  const captureViewportAnchor = useCallback((generation: number) => {
    const viewport = viewportRef.current;
    if (!viewport || captureChatScrollMemory(viewport).atEnd) {
      viewportAnchorRef.current = null;
      return;
    }
    const viewportRect = viewport.getBoundingClientRect();
    const isVisible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
    };
    const visibleElement = visibleIdsRef.current
      .map((messageId) => viewport.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`))
      .find((element): element is HTMLElement => !!element && isVisible(element));
    const element = visibleElement ?? Array.from(
      viewport.querySelectorAll<HTMLElement>("[data-message-id]"),
    ).find(isVisible);
    const messageId = element?.dataset.messageId;
    if (!element || !messageId) {
      viewportAnchorRef.current = null;
      return;
    }
    viewportAnchorRef.current = {
      generation,
      messageId,
      scrollTop: viewport.scrollTop,
      viewportTop: element.getBoundingClientRect().top - viewportRect.top,
    };
  }, [viewportRef]);

  useLayoutEffect(() => {
    const anchor = viewportAnchorRef.current;
    const viewport = viewportRef.current;
    if (!anchor || !viewport || anchor.generation !== rollout.generation) return;
    const element = viewport.querySelector<HTMLElement>(
      `[data-message-id="${anchor.messageId}"]`,
    );
    if (!element) {
      viewportAnchorRef.current = null;
      return;
    }
    const currentViewportTop = element.getBoundingClientRect().top
      - viewport.getBoundingClientRect().top;
    const delta = resolveViewportAnchorDelta(
      anchor.viewportTop,
      currentViewportTop,
      anchor.scrollTop,
      viewport.scrollTop,
    );
    if (delta) viewport.scrollTop += delta;
    if (!rollout.applied) {
      rolloutActiveRef.current = false;
      viewportAnchorRef.current = null;
    }
  }, [rollout, viewportRef]);

  useEffect(() => {
    const conversationChanged = previousConversationIdRef.current !== conversationId;
    previousConversationIdRef.current = conversationId;

    if (conversationChanged) {
      previousTargetRef.current = target;
      generationRef.current += 1;
      rolloutActiveRef.current = false;
      viewportAnchorRef.current = null;
      setRollout({
        conversationId,
        target,
        applied: null,
        generation: generationRef.current,
      });
      return;
    }
    if (sameRenderStyle(previousTargetRef.current, target)) return;
    previousTargetRef.current = target;

    const generation = ++generationRef.current;
    rolloutActiveRef.current = true;
    const currentMessages = messagesRef.current;
    const visibleIndices = new Set(
      visibleIdsRef.current
        .map((id) => Number(id.slice(4)))
        .filter((index) => Number.isInteger(index) && currentMessages[index]?.role === "assistant"),
    );
    const pending = currentMessages
      .map((message, index) => message.role === "assistant" ? index : -1)
      .filter((index) => index >= 0 && !visibleIndices.has(index))
      .reverse();

    captureViewportAnchor(generation);
    setRollout((previous) => startRenderStyleRollout(
      previous,
      target,
      currentMessages,
      visibleIndices,
      generation,
      conversationId,
    ));

    let frame = 0;
    let cursor = 0;
    const flush = () => {
      const batch = pending.slice(cursor, cursor + RENDER_STYLE_BATCH_SIZE);
      cursor += batch.length;
      captureViewportAnchor(generation);
      setRollout((previous) => applyRenderStyleBatch(previous, batch, generation));
      if (cursor < pending.length) {
        frame = requestAnimationFrame(flush);
      } else {
        setRollout((previous) => settleRenderStyleRollout(previous, generation));
      }
    };
    if (pending.length > 0) {
      frame = requestAnimationFrame(flush);
    } else {
      setRollout((previous) => settleRenderStyleRollout(previous, generation));
    }
    return () => cancelAnimationFrame(frame);
  }, [captureViewportAnchor, conversationId, target]);

  useEffect(() => {
    if (!rolloutActiveRef.current) return;
    const visibleIndices = visibleMessageIds
      .map((id) => Number(id.slice(4)))
      .filter((index) => Number.isInteger(index) && messagesRef.current[index]?.role === "assistant");
    captureViewportAnchor(generationRef.current);
    setRollout((previous) => applyRenderStyleBatch(
      previous,
      visibleIndices,
      generationRef.current,
    ));
  }, [captureViewportAnchor, visibleMessageIds]);

  const resolve = useCallback(
    (index: number) => rollout.conversationId === conversationId
      ? resolveRenderStyle(rollout, index)
      : target,
    [conversationId, rollout, target],
  );
  return children(resolve);
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
  isPaper,
  onRegenerate,
  onEdit,
  onSwitchVersion,
  onOpenArtifact,
  onDelete,
  onContinue,
  onFeedbackChange,
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
  // messages 在流式期间每帧变化,用 ref 持有(effect 同步,事件时必为最新)使回调引用稳定——
  // 否则 ChatMessageItem 的 React.memo 会被逐帧击穿,整棵消息列表每个 rAF 帧都在重渲染。
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 流式状态播报:屏幕阅读器经 aria-live 获知生成开始/完成,仅在状态翻转时更新文本。
  const [srAnnouncement, setSrAnnouncement] = useState("");
  const prevStreamingRef = useRef(streaming);
  useEffect(() => {
    if (prevStreamingRef.current === streaming) return;
    prevStreamingRef.current = streaming;
    setSrAnnouncement(streaming ? t("generating") : t("generationDone"));
  }, [streaming, t]);
  const handleRegenerate = useCallback(
    (publicId: string, model: string) => {
      // 被重新生成的是 assistant,向前找最近一条 user 消息,标记为锚定目标(nonce 保证同轮反复触发)
      const msgs = messagesRef.current;
      const aIdx = msgs.findIndex((m) => m.publicId === publicId);
      let uIdx = -1;
      for (let i = aIdx; i >= 0; i--) {
        if (msgs[i].role === "user") { uIdx = i; break; }
      }
      if (uIdx >= 0) setRegenTarget(`msg-${uIdx}#${Date.now()}`);
      onRegenerate?.(publicId, model);
    },
    [onRegenerate],
  );
  const handleEdit = useCallback(
    (
      publicId: string,
      newContent: string,
      attachmentFileIds: string[],
      model: string,
    ) => {
      // 编辑的是 user 消息,直接锚定它到中上部(同重新生成机制);editAndResend 会截断到该 user
      // 并追加空 assistant,ScrollAnchor 据此锚定 + 接管到底跟随。
      const uIdx = messagesRef.current.findIndex((m) => m.publicId === publicId);
      if (uIdx >= 0) setRegenTarget(`msg-${uIdx}#${Date.now()}`);
      onEdit?.(publicId, newContent, attachmentFileIds, model);
    },
    [onEdit],
  );
  const handleRequestDelete = useCallback((pid: string) => setPendingDelete(pid), []);
  // 视口 ref:供选区检测判断选区是否落在消息区内
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollPositionRestorerRef = useRef<ScrollPositionRestorerHandle>(null);

  // ===== 会话滚动位置记忆 =====
  // 进入会话时固定读取一次记忆,避免本会话后续 scroll 事件改变恢复动作。
  const savedScroll = useMemo(
    () => conversationId ? scrollMemory.get(conversationId) : undefined,
    [conversationId],
  );
  const previousConversationIdRef = useRef(conversationId);
  useLayoutEffect(() => {
    const previousConversationId = previousConversationIdRef.current;
    previousConversationIdRef.current = conversationId;
    if (!conversationId) return;

    const action = resolveChatScrollEntry(savedScroll);
    if (action.kind === "restore") {
      scrollPositionRestorerRef.current?.restore(action.scrollTop);
      return;
    }

    // 真实会话切换应打开当前末尾;新会话 undefined -> id 回填保留已建立的 user 消息锚点。
    if (previousConversationId && previousConversationId !== conversationId) {
      scrollPositionRestorerRef.current?.followEnd();
    }
  }, [conversationId, savedScroll]);
  const handleViewportScroll = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || !conversationId) return;
    scrollMemory.set(conversationId, captureChatScrollMemory(vp));
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
    <MessageScroller.Provider
      autoScroll
      defaultScrollPosition="end"
      scrollEdgeThreshold={CHAT_SCROLL_EDGE_THRESHOLD}
    >
      {/* Root 即消息区外层容器,对话大纲/回到最新按钮锚定其内 */}
      <MessageScroller.Root className="relative flex-1 min-h-0 animate-in fade-in slide-in-from-bottom-2 duration-200">
        <MessageScroller.Viewport
          ref={viewportRef}
          onScroll={handleViewportScroll}
          className="scrollbar-hidden @container h-full overflow-y-auto px-6 pt-8 [overflow-anchor:none] md:pt-12"
          style={{ paddingBottom: bottomInset ?? 8 }}
          preserveScrollOnPrepend
        >
          <ProgressiveRenderStyle
            messages={messages}
            conversationId={conversationId}
            cssClass={renderStyleClass}
            renderer={renderStyleRenderer}
            isPaper={isPaper}
            viewportRef={viewportRef}
          >
            {(resolveStyle) => (
              <MessageScroller.Content className="mx-auto flex w-full max-w-[75ch] flex-col">
                {messages.map((m, i) => {
                  const style = resolveStyle(i);
                  return (
                    // scrollAnchor 标在 user 消息:新轮锚定到该 user 消息(中上部),回复在其下方生长
                    <MessageScroller.Item
                      key={i}
                      messageId={`msg-${i}`}
                      scrollAnchor={m.role === "user"}
                      className="py-4"
                    >
                      <MessageTimeSeparator
                        createdAt={m.createdAt}
                        previousCreatedAt={messages[i - 1]?.createdAt}
                        isFirst={i === 0}
                      />
                      <ErrorBoundary name="message">
                        <ChatMessageItem
                          domId={`msg-${i}`}
                          message={m}
                          isLast={i === messages.length - 1}
                          isStreaming={streaming}
                          model={model}
                          renderStyleClass={m.role === "assistant" ? style.cssClass : undefined}
                          renderStyleRenderer={m.role === "assistant" ? style.renderer : undefined}
                          isPaper={m.role === "assistant" ? style.isPaper : undefined}
                          onRegenerate={handleRegenerate}
                          onEdit={handleEdit}
                          onSwitchVersion={onSwitchVersion}
                          onOpenArtifact={onOpenArtifact}
                          onRequestDelete={handleRequestDelete}
                          conversationStreaming={streaming}
                          onContinue={onContinue}
                          onFeedbackChange={onFeedbackChange}
                          models={models}
                        />
                      </ErrorBoundary>
                    </MessageScroller.Item>
                  );
                })}
              </MessageScroller.Content>
            )}
          </ProgressiveRenderStyle>
        </MessageScroller.Viewport>

        {/* 流式状态对屏幕阅读器的播报(视觉隐藏) */}
        <div aria-live="polite" role="status" className="sr-only">
          {srAnnouncement}
        </div>

        {/* 滚动内容没入头部下方的柔化遮罩:仅非空会话渲染——空会话欢迎态头部透明、
            背景是天幕渐变,白色遮罩会显成一条亮带接缝 */}
        {messages.length > 0 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 bg-gradient-to-b from-nebula-white via-nebula-white/70 to-transparent animate-in fade-in duration-500  "
          />
        )}

        {/* 对话大纲:右侧仅保留一列圆点，展开面板同时承载会话轮次与当前回答标题。
            高亮/跳转由其内部 useMessageScrollerVisibility/useMessageScroller 承载(在 Provider 内)。 */}
        <ChatOutline messages={messages} streaming={streaming} />

        <ScrollPositionRestorer ref={scrollPositionRestorerRef} viewportRef={viewportRef} />

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
            className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-morning-mist  bg-white  px-1 py-0.5 shadow-md animate-in fade-in duration-100"
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
              className="ai-trigger inline-flex items-center gap-1 rounded px-2 py-1 text-ui-caption font-semibold text-neutral-500 hover:text-neutral-800  hover:bg-neutral-100  cursor-pointer"
              title={t("copy")}
            >
              <AICopyIcon className="w-3 h-3" />{t("copy")}
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
                  : "text-neutral-500 hover:text-neutral-800  hover:bg-neutral-100 ",
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
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-ui-caption font-semibold text-neutral-500 hover:text-neutral-800  hover:bg-neutral-100  cursor-pointer"
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
          className="touch-target absolute left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 rounded-full border border-morning-mist  bg-white  px-3 py-1.5 text-ui-caption font-semibold text-neutral-600  shadow-sm hover:bg-neutral-50  transition-[background-color,opacity,transform] duration-300 ease-out data-[active=false]:pointer-events-none data-[active=false]:opacity-0 data-[active=false]:translate-y-4 data-[active=false]:scale-95 data-[active=true]:opacity-100 data-[active=true]:translate-y-0 data-[active=true]:scale-100"
        >
          <ChevronDown className="w-3.5 h-3.5 animate-[scroll-hint_1.6s_ease-in-out_infinite]" aria-hidden="true" />
          <span>{t("scrollToLatest")}</span>
        </MessageScroller.Button>
      </MessageScroller.Root>
    </MessageScroller.Provider>
  );
}
