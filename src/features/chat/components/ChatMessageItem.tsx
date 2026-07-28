"use client";

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Copy,
  CornerDownRight,
  Database,
  ExternalLink,
  Info,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { Markdown } from "@/shared/components/markdown/Markdown";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { Badge } from "@/shared/ui/Badge";
import type {
  ChatMessage,
  ChatMessageAttachment,
  MessageFeedback,
  MessageRunMetadata,
  ModelOption,
} from "@/features/chat/model/types";
import type { Artifact } from "@/features/artifacts/ArtifactPanel";
import { FEEDBACK_REASONS, type FeedbackReason } from "@/features/chat/model/feedback";
import { setMessageFeedback } from "@/features/chat/actions/feedback";

import { copyToClipboard } from "@/shared/lib/clipboard";
import { formatDateTimeLocal, formatDuration } from "@/shared/lib/format";
import { ASSISTANT_MESSAGE_CLASS, USER_MESSAGE_BUBBLE_CLASS } from "@/features/chat/components/messagePresentation";
import { useClickOutside } from "@/shared/lib/useClickOutside";
import { MessageImageAttachments } from "@/features/chat/components/MessageImageAttachments";

/** 用户消息超过此行数才折叠(长消息默认收起,避免撑高会话)。 */
const USER_MESSAGE_COLLAPSE_LINES = 6;
/** lineHeight 取不到时的兜底折叠高度(6 行 × 1.75rem × 16px)。 */
const USER_MESSAGE_COLLAPSE_FALLBACK_HEIGHT = USER_MESSAGE_COLLAPSE_LINES * 1.75 * 16;

const FEEDBACK_REASON_I18N: Record<FeedbackReason, string> = {
  incorrect: "feedbackReasonIncorrect",
  irrelevant: "feedbackReasonIrrelevant",
  outdated: "feedbackReasonOutdated",
  unsafe: "feedbackReasonUnsafe",
  other: "feedbackReasonOther",
};

interface RunMetadataFieldsProps {
  metadata: MessageRunMetadata;
  className?: string;
}

/** 以固定顺序投影真实可用字段；未知值隐藏，数值 0 保留。 */
function RunMetadataFields({ metadata, className }: RunMetadataFieldsProps) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const model = metadata.model?.trim();
  const tokenItems = [
    {
      key: "input",
      label: t("inputTokens"),
      value: metadata.tokenUsage?.promptTokens,
      Icon: ArrowDownToLine,
    },
    {
      key: "cache",
      label: t("cacheReadTokens"),
      value: metadata.tokenUsage?.cacheReadTokens,
      Icon: Database,
    },
    {
      key: "output",
      label: t("outputTokens"),
      value: metadata.tokenUsage?.completionTokens,
      Icon: ArrowUpFromLine,
    },
  ];

  return (
    <dl
      className={clsx(
        "flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-ui-micro text-space-ink/50 dark:text-nebula-silver/50",
        className,
      )}
    >
      {model && (
        <div className="inline-flex min-w-0 max-w-full items-center gap-1">
          <dt className="inline-flex shrink-0 items-center gap-1">
            <Bot className="size-2.5" aria-hidden="true" />
            <span>{t("responseModel")}</span>
          </dt>
          <dd
            className="min-w-0 max-w-[min(18rem,60vw)] truncate text-space-ink/55 dark:text-nebula-silver/55"
            title={model}
          >
            {model}
          </dd>
        </div>
      )}
      {tokenItems.map(({ key, label, value, Icon }) => (
        typeof value === "number" ? (
          <div key={key} className="inline-flex items-center gap-1">
            <dt className="inline-flex items-center gap-1">
              <Icon className="size-2.5" aria-hidden="true" />
              <span>{label}</span>
            </dt>
            <dd className="font-mono tabular-nums text-space-ink/55 dark:text-nebula-silver/55">
              {value.toLocaleString(locale)}
            </dd>
          </div>
        ) : null
      ))}
      {typeof metadata.durationMs === "number" && (
        <div className="inline-flex items-center gap-1">
          <dt className="inline-flex items-center gap-1">
            <Clock3 className="size-2.5" aria-hidden="true" />
            <span>{t("responseDuration")}</span>
          </dt>
          <dd className="font-mono tabular-nums text-space-ink/55 dark:text-nebula-silver/55">
            {formatDuration(metadata.durationMs)}
          </dd>
        </div>
      )}
    </dl>
  );
}

interface MessageRunMetadataDisplayProps {
  metadata: MessageRunMetadata;
  expanded: boolean;
  panelId: string;
}

function hasRunDetails(metadata: MessageRunMetadata) {
  return Boolean(
    metadata.model?.trim()
      || typeof metadata.tokenUsage?.promptTokens === "number"
      || typeof metadata.tokenUsage?.cacheReadTokens === "number"
      || typeof metadata.tokenUsage?.completionTokens === "number"
      || typeof metadata.durationMs === "number",
  );
}

function hasRunMetadata(metadata: MessageRunMetadata) {
  return hasRunDetails(metadata) || Boolean(metadata.completedAt);
}

/** assistant 回复底部的低干扰运行元数据入口。 */
export function MessageRunMetadataDisplay({
  metadata,
  expanded,
  panelId,
}: MessageRunMetadataDisplayProps) {
  const t = useTranslations("chat");

  if (!hasRunDetails(metadata)) return null;

  return (
    <>
      <div
        role="group"
        aria-label={t("responseDetails")}
        className="min-w-0 max-w-full [@media(pointer:coarse)]:hidden"
      >
        <RunMetadataFields metadata={metadata} className="justify-start" />
      </div>
      {expanded && (
        <div
          id={panelId}
          role="region"
          aria-label={t("responseDetails")}
          className="hidden min-w-0 max-w-full border-t border-morning-mist/80 pt-2 dark:border-deep-space/80 [@media(pointer:coarse)]:block"
        >
          <RunMetadataFields metadata={metadata} className="justify-start" />
        </div>
      )}
    </>
  );
}

interface ChatMessageItemProps {
  message: ChatMessage;
  isLast: boolean;
  isStreaming: boolean;
  model: string;
  /** 当前会话选用的输出样式 cssClass(null 表示默认渲染)。容器会套上 rs-{cssClass} 作为 CSS 作用域。 */
  renderStyleClass?: string | null;
  /** 当前会话选用样式的渲染器类型(custom=流式结束后用内置解析器重渲;默认 streamdown)。 */
  renderStyleRenderer?: "streamdown" | "custom";
  onRegenerate: (publicId: string, model: string) => void;
  onOpenArtifact: (a: Artifact) => void;
  /** 编辑用户消息后重发(publicId 为被编辑 user 消息的稳定标识)。 */
  onEdit?: (
    publicId: string,
    newContent: string,
    attachmentFileIds: string[],
    model: string,
  ) => void;
  /** 切换该 assistant 消息的版本(同级兄弟)。 */
  onSwitchVersion?: (publicId: string, direction: "prev" | "next") => void;
  /** 请求删除该消息(由父层弹统一确认弹窗,确认后真正执行)。 */
  onRequestDelete?: (publicId: string) => void;
  /** 会话级是否正在生成(生成中时禁用删除并置灰)。 */
  conversationStreaming?: boolean;
  /** 在 assistant 消息末尾续写生成。 */
  onContinue?: (publicId: string) => void;
  /** 反馈变更后同步到 store(乐观结果/失败回滚)。 */
  onFeedbackChange?: (publicId: string, feedback: MessageFeedback | undefined) => void;
  /** 可用模型列表(>1 时重新生成弹出换模型选择)。 */
  models?: ModelOption[];
  /** 挂到最外层的 DOM id,供外部跳转定位(scrollIntoView)。 */
  domId?: string;
}

function ChatMessageItemContent({
  message,
  isLast,
  isStreaming,
  model,
  renderStyleClass,
  renderStyleRenderer,
  onRegenerate,
  onOpenArtifact,
  onEdit,
  onSwitchVersion,
  onRequestDelete,
  conversationStreaming,
  onContinue,
  onFeedbackChange,
  models = [],
  domId,
}: ChatMessageItemProps) {
  const t = useTranslations("chat");
  const metadataPanelId = `run-metadata-${useId()}`;
  const {
    role,
    content,
    reasoning,
    publicId,
    status,
    toolCalls,
    searchResults,
    versionInfo,
    feedback,
    runMetadata,
    attachments = [],
  } = message;
  const hasReasoning = Boolean(reasoning);
  const visibleRunMetadata = runMetadata && status !== "interrupted" && hasRunMetadata(runMetadata)
    ? runMetadata
    : undefined;

  // 用户消息编辑态
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [draftAttachments, setDraftAttachments] = useState<ChatMessageAttachment[]>(attachments);

  const attachmentIdsChanged =
    draftAttachments.length !== attachments.length
    || draftAttachments.some((attachment, index) => attachment.fileId !== attachments[index]?.fileId);
  const canSubmitEdit = Boolean(
    (draft.trim() || draftAttachments.length > 0)
    && (draft.trim() !== content.trim() || attachmentIdsChanged),
  );
  const submitEdit = () => {
    if (!publicId || !onEdit || !canSubmitEdit) return;
    onEdit(
      publicId,
      draft.trim(),
      draftAttachments.map((attachment) => attachment.fileId),
      model,
    );
    setEditing(false);
  };

  // 复制按钮反馈
  const [copied, setCopied] = useState(false);
  // 粗指针设备的回复元数据展开状态
  const [metadataExpanded, setMetadataExpanded] = useState(false);

  // 重新生成换模型选择弹层(仅多模型时启用)
  const [regenOpen, setRegenOpen] = useState(false);

  // 质量反馈:本地乐观态 + 踩后原因菜单
  const [localFeedback, setLocalFeedback] = useState<MessageFeedback | undefined>(feedback);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackFailed, setFeedbackFailed] = useState(false);
  const [reasonMenuOpen, setReasonMenuOpen] = useState(false);
  const feedbackMenuRef = useRef<HTMLDivElement>(null);
  const feedbackRequestRef = useRef(0);

  // 思考样式条弹层状态:点击样式条打开侧边浮层查看完整思考内容
  const [reasoningPanelOpen, setReasoningPanelOpen] = useState(false);

  // 思考耗时计时:reasoning 首次出现记开始时间;正文开始或流结束记结束时间
  const reasoningStartRef = useRef<number | null>(null);
  const reasoningEndRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  // 用户消息长文本折叠:基于实际行高判断是否超过 6 行(含自动换行),避免纯按 \n 计数漏判。
  const [userMsgExpanded, setUserMsgExpanded] = useState(false);
  const [userMsgCanCollapse, setUserMsgCanCollapse] = useState(false);
  const [userMsgCollapsedHeight, setUserMsgCollapsedHeight] = useState(
    USER_MESSAGE_COLLAPSE_FALLBACK_HEIGHT,
  );
  const userMsgRef = useRef<HTMLDivElement>(null);

  // 移动端长按(桌面右键)消息弹出的操作菜单:编辑 / 删除
  const [menuOpen, setMenuOpen] = useState(false);
  // contextmenu 触发后抑制紧随的 click,避免长按后又误触折叠 toggle
  const contextMenuFiredRef = useRef(false);

  // 消息身份变化会由外层 key 重挂；卸载时使未完成的反馈请求失效。
  useEffect(() => {
    return () => {
      feedbackRequestRef.current += 1;
    };
  }, []);

  // 记录思考开始/结束时间,并计算耗时
  useEffect(() => {
    if (!hasReasoning) return;
    // reasoning 首次出现 → 记开始
    if (reasoningStartRef.current === null) {
      reasoningStartRef.current = Date.now();
    }
    // 思考完成的判定:有正文开始,或流式已结束
    const done = Boolean(content) || !(isStreaming && isLast);
    if (done && reasoningEndRef.current === null) {
      reasoningEndRef.current = Date.now();
      if (reasoningStartRef.current) {
        const secs = Math.max(1, Math.round((reasoningEndRef.current - reasoningStartRef.current) / 1000));
        setElapsed(secs);
      }
    }
  }, [hasReasoning, content, isStreaming, isLast]);

  // 思考是否已完成:有耗时数据即为完成
  const reasoningDone = elapsed !== null;

  // 流式思考中:正在生成且本条是最后一条且还没正文
  // 注意:有 reasoning 时思考条已占位,下方 content 的等待态需加 !hasReasoning 判断,
  // 否则会出现两个「思考中」(思考条 + content fallback 各一个)。
  const isReasoningActive = hasReasoning && isStreaming && isLast && !content;
  // 流式思考时把单行文本横向滚到最右,使最新吐字始终可见
  const reasoningScrollRef = useRef<HTMLSpanElement>(null);

  // 思考块触发区容器(含浮层):用于「点击外部收起」判定
  const reasoningRef = useRef<HTMLDivElement>(null);
  // 重新生成换模型菜单容器
  const regenMenuRef = useRef<HTMLDivElement>(null);
  // hover 进/出延迟计时(0.5s):避免鼠标划过误触展开,也给鼠标移动留过渡时间
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHoverTimer = () => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
  };
  useEffect(() => {
    if (reasoningScrollRef.current) {
      reasoningScrollRef.current.scrollLeft = reasoningScrollRef.current.scrollWidth;
    }
  }, [reasoning]);

  // 思考块 / 重生成菜单 / 踩原因菜单:document 级外部点击收起(避免 fixed 遮罩被祖先 stacking 影响)
  useClickOutside(reasoningRef, () => {
    clearHoverTimer();
    setReasoningPanelOpen(false);
  }, reasoningPanelOpen);
  useClickOutside(regenMenuRef, () => setRegenOpen(false), regenOpen);
  useClickOutside(feedbackMenuRef, () => setReasonMenuOpen(false), reasonMenuOpen);

  // 用户消息折叠测量:基于实际行高计算 6 行高度,scrollHeight 超过则可折叠。
  // content 变化(编辑后)或首次挂载时重测;ResizeObserver 兜底宽度变化导致的换行变化。
  useLayoutEffect(() => {
    const el = userMsgRef.current;
    if (!el) {
      setUserMsgCanCollapse(false);
      return;
    }
    const measure = () => {
      const lh = Number.parseFloat(window.getComputedStyle(el).lineHeight);
      const collapsed =
        Number.isFinite(lh) && lh > 0
          ? lh * USER_MESSAGE_COLLAPSE_LINES
          : USER_MESSAGE_COLLAPSE_FALLBACK_HEIGHT;
      setUserMsgCollapsedHeight(collapsed);
      setUserMsgCanCollapse(el.scrollHeight > collapsed + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [content]);

  const applyFeedback = async (
    nextRating: "up" | "down" | null,
    nextReason: FeedbackReason | null = null,
    openReasonMenu = false,
  ) => {
    if (!publicId || feedbackPending) return;
    const requestId = feedbackRequestRef.current + 1;
    feedbackRequestRef.current = requestId;
    const requestPublicId = publicId;
    const isCurrentRequest = () => feedbackRequestRef.current === requestId;
    const prev = localFeedback;
    // 与服务端契约对齐:up 无 reason;down 仅在传入 reason 时带上
    const optimistic: MessageFeedback | undefined =
      nextRating === null
        ? undefined
        : nextRating === "up"
          ? { rating: "up" }
          : nextReason
            ? { rating: "down", reason: nextReason }
            : { rating: "down" };
    // 乐观更新
    setLocalFeedback(optimistic);
    onFeedbackChange?.(requestPublicId, optimistic);
    setFeedbackPending(true);
    setFeedbackFailed(false);
    if (openReasonMenu) setReasonMenuOpen(true);
    else if (nextRating !== "down") setReasonMenuOpen(false);

    try {
      const saved = await setMessageFeedback(requestPublicId, nextRating, nextReason);
      if (!isCurrentRequest()) return;
      const normalized = saved ?? undefined;
      setLocalFeedback(normalized);
      onFeedbackChange?.(requestPublicId, normalized);
    } catch {
      if (!isCurrentRequest()) return;
      setLocalFeedback(prev);
      onFeedbackChange?.(requestPublicId, prev);
      setFeedbackFailed(true);
      if (openReasonMenu) setReasonMenuOpen(false);
    } finally {
      if (isCurrentRequest()) setFeedbackPending(false);
    }
  };

  const handleThumbsUp = () => {
    if (!publicId || feedbackPending) return;
    if (localFeedback?.rating === "up") {
      void applyFeedback(null);
      return;
    }
    void applyFeedback("up");
  };

  const handleThumbsDown = () => {
    if (!publicId || feedbackPending) return;
    if (localFeedback?.rating === "down") {
      void applyFeedback(null);
      return;
    }
    void applyFeedback("down", null, true);
  };

  const handleReasonSelect = (reason: FeedbackReason) => {
    if (!publicId || feedbackPending) return;
    // 再次点已选原因:仅关闭菜单,不撤销评分
    if (localFeedback?.rating === "down" && localFeedback.reason === reason) {
      setReasonMenuOpen(false);
      return;
    }
    setReasonMenuOpen(false);
    void applyFeedback("down", reason);
  };

  const handleCopy = async () => {
    if (!content) return;
    const ok = await copyToClipboard(content);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      console.warn("[ChatMessageItem] 复制失败:当前环境剪贴板不可用");
    }
  };

  // 是否可弹出操作菜单(移动长按 / 桌面右键):至少有编辑或删除之一可用
  const canEdit = Boolean(publicId && onEdit && !isStreaming && !conversationStreaming);
  const canDelete = Boolean(publicId && onRequestDelete && !conversationStreaming);
  const canShowMenu = canEdit || canDelete;

  return (
    <div id={domId} className={clsx("group/message relative flex animate-in fade-in duration-200 scroll-mt-4", role === "user" ? "justify-end" : "justify-start")}>
      {role === "assistant" && (
        <div className="absolute inset-y-0 -left-11 hidden w-7 @min-[54rem]:block">
          <button
            type="button"
            onClick={() => {
              if (!domId) return;
              document.getElementById(domId)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="sticky top-4 mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-sora-blue/10 bg-sora-blue/[0.04] cursor-pointer transition-colors hover:bg-sora-blue/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
            title={t("scrollToReplyTop")}
            aria-label={t("scrollToReplyTop")}
          >
            <Sparkles className="w-3.5 h-3.5 text-sora-blue" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className={clsx("space-y-2", role === "user" ? "flex flex-col items-end w-full max-w-[70%]" : "flex-1 min-w-0")}>
        {role === "user" ? (
          /* 用户消息: 可编辑文本气泡 */
          (editing ? (<div className="w-full space-y-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitEdit();
                }
                if (e.key === "Escape") setEditing(false);
              }}
              rows={Math.min(8, Math.max(2, draft.split("\n").length))}
              className="w-full rounded-2xl bg-neutral-900 text-white dark:bg-white dark:text-black px-4 py-2.5 text-ui-reading leading-7 resize-none border border-sora-blue/40 focus:outline-none focus:border-sora-blue"
              autoFocus
            />
            <MessageImageAttachments
              attachments={draftAttachments}
              onRemove={(fileId) => {
                setDraftAttachments((current) =>
                  current.filter((attachment) => attachment.fileId !== fileId),
                );
              }}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraft(content);
                  setDraftAttachments(attachments);
                  setEditing(false);
                }}
                className="inline-flex items-center gap-1 text-ui-caption font-semibold text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors cursor-pointer"
              >
                <X className="w-3 h-3" aria-hidden="true" />
                <span>{t("editCancel")}</span>
              </button>
              <button
                type="button"
                disabled={!canSubmitEdit}
                onClick={submitEdit}
                className="inline-flex items-center gap-1 text-ui-caption font-semibold text-sora-blue hover:opacity-80 disabled:opacity-40 transition-opacity cursor-pointer"
              >
                <Check className="w-3 h-3" aria-hidden="true" />
                <span>{t("editSaveAndResend")}</span>
              </button>
            </div>
          </div>) : (<div className="group relative w-full">
            <div className="flex w-full flex-col items-end gap-1.5">
              <MessageImageAttachments attachments={attachments} />
            {content ? (<div
              ref={userMsgRef}
              onContextMenu={(e) => {
                if (!canShowMenu) return;
                e.preventDefault();
                contextMenuFiredRef.current = true;
                setMenuOpen(true);
              }}
              onClick={() => {
                if (contextMenuFiredRef.current) { contextMenuFiredRef.current = false; return; }
                if (!userMsgCanCollapse) return;
                // 有选区时(划词选择)不触发,避免与复制/引用冲突
                const sel = window.getSelection();
                if (sel && sel.toString().trim()) return;
                setUserMsgExpanded((v) => !v);
              }}
              className={clsx(
                USER_MESSAGE_BUBBLE_CLASS,
                "transition-[max-height] duration-300 ease-out",
                userMsgCanCollapse && "cursor-pointer",
              )}
              style={
                userMsgCanCollapse && !userMsgExpanded
                  ? { maxHeight: userMsgCollapsedHeight }
                  : undefined
              }
            >
              {content}
              {userMsgCanCollapse && !userMsgExpanded ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-b from-transparent to-neutral-900 dark:to-white" />
              ) : null}
            </div>) : null}
            {content && userMsgCanCollapse ? (
              <button
                type="button"
                onClick={() => setUserMsgExpanded((v) => !v)}
                className="mt-1 flex w-fit ml-auto items-center gap-1 text-ui-caption font-semibold text-white/70 dark:text-black/60 hover:text-white dark:hover:text-black transition-colors cursor-pointer"
                aria-expanded={userMsgExpanded}
              >
                {userMsgExpanded ? (
                  <ChevronUp className="w-3 h-3" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-3 h-3" aria-hidden="true" />
                )}
                <span>
                  {userMsgExpanded ? t("collapseUserMessage") : t("expandUserMessage")}
                </span>
              </button>
            ) : null}
            </div>
            {publicId && onEdit && !isStreaming && !conversationStreaming && (
              <button
                type="button"
                onClick={() => {
                  setDraft(content);
                  setDraftAttachments(attachments);
                  setEditing(true);
                }}
                className="absolute -left-7 top-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
                title={t("edit")}
                aria-label={t("edit")}
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
            {publicId && onRequestDelete && !conversationStreaming && (
              <button
                type="button"
                onClick={() => onRequestDelete?.(publicId)}
                className="absolute -left-7 top-7 p-1 rounded opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 dark:hover:text-red-400 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
                title={t("delete")}
                aria-label={t("delete")}
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>))
        ) : (
          /* Assistant 消息: 流式 markdown 渲染 */
          (<div className={clsx(
            ASSISTANT_MESSAGE_CLASS,
            renderStyleClass && `rs-${renderStyleClass}`,
          )}>
            {hasReasoning && (
              <div className="mb-2">
                {/* 思考单行:未吐字显「思考中」,吐字时一行截断,完成后收成「已思考X秒」。点击看全文 */}
                {/* 触发区只包内容(不撑满整行),箭头紧跟文字;点击展开/收起,hover 仅作视觉反馈 */}
                <div
                  ref={reasoningRef}
                  role="button"
                  tabIndex={0}
                  aria-expanded={reasoningPanelOpen}
                  onClick={() => { clearHoverTimer(); setReasoningPanelOpen((v) => !v); }}
                  onMouseEnter={() => { clearHoverTimer(); hoverTimerRef.current = setTimeout(() => setReasoningPanelOpen(true), 500); }}
                  onMouseLeave={() => { clearHoverTimer(); hoverTimerRef.current = setTimeout(() => setReasoningPanelOpen(false), 500); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setReasoningPanelOpen((v) => !v);
                    }
                  }}
                  className={clsx(
                    "relative inline-flex items-center gap-1.5 max-w-full rounded-md px-2.5 py-1 text-ui-caption font-mono select-none text-neutral-400 dark:text-neutral-500 transition-colors hover:bg-neutral-50/70 dark:hover:bg-[#0d0f14]/20 cursor-pointer",
                    reasoningPanelOpen && "bg-neutral-50/70 dark:bg-[#0d0f14]/20",
                  )}
                >
                  {isReasoningActive ? (
                    <Loader2 className="w-3 h-3 shrink-0 animate-spin text-sora-blue/70" aria-hidden="true" />
                  ) : (
                    <Sparkles className="w-3 h-3 shrink-0 opacity-70" aria-hidden="true" />
                  )}
                  <span className="shrink-0">
                    {reasoningDone ? t("thoughtFor", { seconds: elapsed }) : t("thinking")}
                  </span>
                  {/* 吐字区域:单行,溢出截断,弱化 */}
                  {isReasoningActive && reasoning && (
                    <span
                      ref={reasoningScrollRef}
                      className="min-w-0 max-w-[44ch] overflow-x-hidden whitespace-nowrap text-neutral-400/70 dark:text-neutral-600"
                    >
                      {reasoning}
                    </span>
                  )}
                  {/* 箭头:紧跟文字,随触发区一起点击切换;展开时旋转 90° */}
                  <ChevronRight
                    className={clsx("w-3 h-3 shrink-0 opacity-40 transition-transform duration-200", reasoningPanelOpen && "rotate-90")}
                    aria-hidden="true"
                  />

                  {/* 思考全文弹窗:点击触发区展开,紧贴下方,弱化样式;淡入 + 下滑 + 微缩放动效 */}
                  {reasoningPanelOpen && (
                    <div className="absolute z-40 left-0 top-full mt-1 w-max max-w-[min(75ch,90vw)] max-h-[50vh] overflow-y-auto rounded-lg border border-morning-mist dark:border-deep-space/60 bg-white dark:bg-space-ink p-3 shadow-sm animate-in fade-in slide-in-from-top-1 zoom-in-95 duration-150">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-ui-caption font-mono text-neutral-400 dark:text-neutral-500">
                          {reasoningDone ? t("thoughtFor", { seconds: elapsed }) : t("thinking")}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setReasoningPanelOpen(false); }}
                          className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 cursor-pointer"
                          aria-label="关闭"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="text-ui-caption text-neutral-500 dark:text-neutral-400 whitespace-pre-wrap break-words leading-relaxed">
                        {reasoning}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {toolCalls && toolCalls.length > 0 && (
              <div className="mb-2 space-y-1">
                {toolCalls.map((tc, ti) => (
                  <ErrorBoundary
                    key={ti}
                    name="tool-call"
                    rawContent={
                      typeof tc.args === "string"
                        ? tc.args
                        : tc.args !== undefined
                          ? JSON.stringify(tc.args)
                          : undefined
                    }
                  >
                    <details
                      open={tc.status === "calling"}
                      className="rounded-md border border-morning-mist dark:border-deep-space/80 bg-neutral-50/40 dark:bg-[#0d0f14]/15 overflow-hidden">
                      <summary className="cursor-pointer hover:text-neutral-600 dark:hover:text-neutral-300 px-3 py-1.5 text-ui-caption font-mono select-none flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue">
                        {tc.status === "calling" ? (
                          <Loader2 className="w-3 h-3 animate-spin text-sora-blue" aria-hidden="true" />
                        ) : tc.status === "error" ? (
                          <AlertCircle className="w-3 h-3 text-red-500" aria-hidden="true" />
                        ) : (
                          <CheckCircle2 className="w-3 h-3 text-green-500" aria-hidden="true" />
                        )}
                        <Wrench className="w-3 h-3 opacity-60" aria-hidden="true" />
                        <span>{tc.toolName}</span>
                      </summary>
                      {tc.args !== undefined && (
                        <div className="px-3 pb-1.5 pt-1 text-ui-caption text-neutral-500 dark:text-neutral-400 border-t border-morning-mist dark:border-deep-space/60 font-mono break-all">
                          {typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args)}
                        </div>
                      )}
                    </details>
                  </ErrorBoundary>
                ))}
              </div>
            )}
            {content ? (
              <ErrorBoundary name="message-markdown" rawContent={content}>
                <Markdown
                  content={content}
                  isStreaming={isStreaming && isLast}
                  renderer={renderStyleRenderer}
                  renderStyleClass={renderStyleClass}
                  onPreview={onOpenArtifact}
                />
              </ErrorBoundary>
            ) : isStreaming && isLast && !hasReasoning ? (
              <span className="inline-flex items-center gap-1.5 text-neutral-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                {t("thinking")}
              </span>
            ) : null}
          </div>)
        )}

        {role === "assistant" && publicId && !(isStreaming && isLast) && (
          <div className="flex min-w-0 max-w-full flex-col items-start gap-1 opacity-0 pointer-events-none transition-opacity duration-150 group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 [@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:opacity-100 motion-reduce:transition-none">
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1 gap-y-1">
            {versionInfo && versionInfo.total > 1 && onSwitchVersion && (
              <div className="inline-flex items-center gap-1 text-ui-caption font-medium text-space-ink/50 dark:text-nebula-silver/50">
                <button
                  onClick={() => onSwitchVersion(publicId, "prev")}
                  className="p-0.5 rounded hover:text-space-ink/75 dark:hover:text-nebula-silver/75 hover:bg-nebula-silver/45 dark:hover:bg-deep-space/55 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer disabled:opacity-30"
                  aria-label={t("prevVersion")}
                  disabled={versionInfo.current <= 1}
                >
                  <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <span className="font-mono tabular-nums">
                  {versionInfo.current} / {versionInfo.total}
                </span>
                <button
                  onClick={() => onSwitchVersion(publicId, "next")}
                  className="p-0.5 rounded hover:text-space-ink/75 dark:hover:text-nebula-silver/75 hover:bg-nebula-silver/45 dark:hover:bg-deep-space/55 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer disabled:opacity-30"
                  aria-label={t("nextVersion")}
                  disabled={versionInfo.current >= versionInfo.total}
                >
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
            <button
              onClick={handleCopy}
              disabled={!content}
              className="touch-target inline-flex h-8 w-8 items-center justify-center rounded-md text-space-ink/50 transition-colors duration-150 hover:bg-nebula-silver/45 hover:text-space-ink/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer disabled:opacity-40 dark:text-nebula-silver/50 dark:hover:bg-deep-space/55 dark:hover:text-nebula-silver/75"
              title={copied ? t("copied") : t("copy")}
              aria-label={copied ? t("copied") : t("copy")}
            >
              {copied ? (
                <Check className="size-3.5 text-sora-blue" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
            </button>
            {/* 质量反馈:icon-only 赞/踩,紧邻原因菜单,不改变其它操作语义 */}
            <div ref={feedbackMenuRef} className="relative inline-flex items-center gap-0.5">
              <button
                type="button"
                onClick={handleThumbsUp}
                disabled={feedbackPending}
                className={clsx(
                  "touch-target inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                  localFeedback?.rating === "up"
                    ? "text-sora-blue bg-sora-blue/10"
                    : "text-space-ink/50 hover:text-space-ink/75 dark:text-nebula-silver/50 dark:hover:text-nebula-silver/75 hover:bg-nebula-silver/45 dark:hover:bg-deep-space/55",
                )}
                aria-label={localFeedback?.rating === "up" ? t("feedbackClear") : t("feedbackUp")}
                title={
                  feedbackFailed
                    ? t("feedbackFailed")
                    : feedbackPending
                      ? t("feedbackPending")
                      : localFeedback?.rating === "up"
                        ? t("feedbackClear")
                        : t("feedbackUp")
                }
                aria-pressed={localFeedback?.rating === "up"}
                aria-busy={feedbackPending || undefined}
              >
                <ThumbsUp className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleThumbsDown}
                disabled={feedbackPending}
                className={clsx(
                  "touch-target inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                  localFeedback?.rating === "down"
                    ? "text-red-600 dark:text-red-400 bg-red-500/10"
                    : "text-space-ink/50 hover:text-space-ink/75 dark:text-nebula-silver/50 dark:hover:text-nebula-silver/75 hover:bg-nebula-silver/45 dark:hover:bg-deep-space/55",
                )}
                aria-label={localFeedback?.rating === "down" ? t("feedbackClear") : t("feedbackDown")}
                title={
                  feedbackFailed
                    ? t("feedbackFailed")
                    : feedbackPending
                      ? t("feedbackPending")
                      : localFeedback?.rating === "down"
                        ? t("feedbackClear")
                        : t("feedbackDown")
                }
                aria-pressed={localFeedback?.rating === "down"}
                // 首次点踩会打开原因菜单;已踩后 ThumbsDown 仅负责撤销,重开交给旁侧 Chevron
                aria-haspopup={localFeedback?.rating === "down" ? undefined : "menu"}
                aria-expanded={localFeedback?.rating === "down" ? undefined : reasonMenuOpen}
                aria-busy={feedbackPending || undefined}
              >
                <ThumbsDown className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              {/* 已踩且菜单关闭:独立入口重开/改选原因,不触碰 rating / DB */}
              {localFeedback?.rating === "down" && !reasonMenuOpen && (
                <button
                  type="button"
                  onClick={() => setReasonMenuOpen((open) => !open)}
                  className="touch-target inline-flex h-8 w-8 items-center justify-center rounded-md text-space-ink/50 hover:text-space-ink/75 dark:text-nebula-silver/50 dark:hover:text-nebula-silver/75 hover:bg-nebula-silver/45 dark:hover:bg-deep-space/55 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
                  aria-label={t("feedbackReasons")}
                  title={t("feedbackReasons")}
                  aria-haspopup="menu"
                  aria-expanded={reasonMenuOpen}
                >
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
              {reasonMenuOpen && (
                <div
                  role="menu"
                  className="absolute bottom-full mb-1.5 left-0 z-40 min-w-[9.5rem] rounded-md border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink py-1 transition-opacity duration-150"
                >
                  {FEEDBACK_REASONS.map((reason) => {
                    const selected = localFeedback?.rating === "down" && localFeedback.reason === reason;
                    return (
                      <button
                        key={reason}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        disabled={feedbackPending}
                        onClick={() => handleReasonSelect(reason)}
                        className={clsx(
                          "flex w-full items-center px-3 py-1.5 text-left text-ui-caption transition-colors duration-150 cursor-pointer disabled:opacity-40",
                          selected
                            ? "text-sora-blue font-semibold"
                            : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
                        )}
                      >
                        {t(FEEDBACK_REASON_I18N[reason])}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {!isStreaming && (
            <div ref={regenMenuRef} className="relative">
              <button
                onClick={() => {
                  if (models.length > 1) setRegenOpen((v) => !v);
                  else onRegenerate(publicId, model);
                }}
                className="touch-target inline-flex h-8 w-8 items-center justify-center rounded-md text-space-ink/50 transition-colors duration-150 hover:bg-nebula-silver/45 hover:text-space-ink/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer dark:text-nebula-silver/50 dark:hover:bg-deep-space/55 dark:hover:text-nebula-silver/75"
                title={t("regenerate")}
                aria-label={t("regenerate")}
                aria-haspopup={models.length > 1 ? "listbox" : undefined}
                aria-expanded={models.length > 1 ? regenOpen : undefined}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
              </button>
              {regenOpen && models.length > 1 && (
                <div className="absolute bottom-full mb-2 right-0 z-40 w-48 max-h-60 overflow-y-auto rounded-lg border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink py-1 shadow-md">
                  {models.map((m) => (
                    <button
                      key={m.modelId}
                      type="button"
                      onClick={() => {
                        onRegenerate(publicId, m.modelId);
                        setRegenOpen(false);
                      }}
                      className={clsx(
                        "flex items-center gap-1.5 w-full text-left px-3 py-1.5 text-ui-caption cursor-pointer transition-colors",
                        m.modelId === model
                          ? "text-sora-blue font-semibold"
                          : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
                      )}
                    >
                      <span className="truncate">{m.displayName ?? m.name}</span>
                      {m.source === "global" && (
                        <Badge variant="primary" className="py-0 leading-none shrink-0">{t("globalLabel")}</Badge>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}
            {!isStreaming && content && status === "interrupted" && (
              <button
                type="button"
                onClick={() => onContinue?.(publicId)}
                className="inline-flex items-center gap-1 text-ui-caption font-medium text-space-ink/50 hover:text-space-ink/75 dark:text-nebula-silver/50 dark:hover:text-nebula-silver/75 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue rounded cursor-pointer"
                aria-label={t("continueGenerating")}
                title={t("continueGenerating")}
              >
                <CornerDownRight className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t("continueGenerating")}</span>
              </button>
            )}
            {visibleRunMetadata && hasRunDetails(visibleRunMetadata) && (
              <button
                type="button"
                onClick={() => setMetadataExpanded((value) => !value)}
                className="touch-target hidden h-8 w-8 items-center justify-center rounded-md text-space-ink/50 transition-colors duration-150 hover:bg-nebula-silver/45 hover:text-space-ink/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:text-nebula-silver/50 dark:hover:bg-deep-space/55 dark:hover:text-nebula-silver/75 [@media(pointer:coarse)]:inline-flex"
                aria-label={t("responseDetails")}
                title={t("responseDetails")}
                aria-controls={metadataPanelId}
                aria-expanded={metadataExpanded}
              >
                <Info className="size-3.5" aria-hidden="true" />
              </button>
            )}
            {visibleRunMetadata?.completedAt && (
              <time
                dateTime={visibleRunMetadata.completedAt}
                title={formatDateTimeLocal(visibleRunMetadata.completedAt)}
                className="inline-flex h-8 shrink-0 items-center font-mono text-ui-body tabular-nums text-space-ink/50 dark:text-nebula-silver/50"
              >
                {formatDateTimeLocal(visibleRunMetadata.completedAt)}
              </time>
            )}
            </div>
            {visibleRunMetadata && (
              <MessageRunMetadataDisplay
                metadata={visibleRunMetadata}
                expanded={metadataExpanded}
                panelId={metadataPanelId}
              />
            )}
          </div>
        )}


        {role === "assistant" && searchResults && searchResults.length > 0 && (
          <details className="text-ui-caption border border-morning-mist dark:border-deep-space/80 rounded-md bg-neutral-50/30 dark:bg-[#0d0f14]/10 overflow-hidden">
            <summary className="cursor-pointer hover:text-neutral-600 dark:hover:text-neutral-300 px-3 py-1.5 select-none flex items-center gap-1.5 text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue">
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
              <span>{t("webSources")} ({searchResults.length})</span>
            </summary>
            <div className="px-3 pb-2 pt-0.5 space-y-1.5 border-t border-morning-mist dark:border-deep-space/60 mt-1">
              {searchResults.map((r, i) => (
                <a
                  key={i}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block group/source rounded px-1 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-900/50 transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="text-sora-blue font-mono shrink-0">[{i + 1}]</span>
                    <span className="text-neutral-700 dark:text-neutral-300 font-medium truncate">{r.title}</span>
                    <ExternalLink className="w-2.5 h-2.5 text-neutral-400 opacity-0 group-hover/source:opacity-100 shrink-0" aria-hidden="true" />
                  </span>
                  <span className="text-ui-caption text-neutral-400 dark:text-neutral-500 block truncate ml-5">{r.url}</span>
                </a>
              ))}
            </div>
          </details>
        )}

      </div>
      {role === "user" && menuOpen && canShowMenu && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="rounded-xl border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink p-1.5 min-w-[160px] shadow-lg animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {canEdit && (
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setDraft(content); setEditing(true); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-ui-body text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-lg transition-colors cursor-pointer"
              >
                <Pencil className="w-4 h-4" aria-hidden="true" />
                <span>{t("edit")}</span>
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => { setMenuOpen(false); if (publicId) onRequestDelete?.(publicId); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-ui-body text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                <span>{t("delete")}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const ChatMessageItem = React.memo(function ChatMessageItem(props: ChatMessageItemProps) {
  return (
    <ChatMessageItemContent
      key={props.message.publicId ?? props.domId ?? props.message.role}
      {...props}
    />
  );
});
