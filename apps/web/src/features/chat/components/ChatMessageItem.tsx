"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUpToLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CornerDownRight,
} from "lucide-react";
import { clsx } from "clsx";
import {
  AICheckIcon,
  AICopyIcon,
  AIPencilIcon,
  AIRefreshCwIcon,
  AIThumbsDownIcon,
  AIThumbsUpIcon,
  AITrash2Icon,
  AIXIcon,
} from "@/shared/components/animated-icons";
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
import { formatDateTimeLocal, formatDateTimeMinute } from "@/shared/lib/format";
import { ASSISTANT_MESSAGE_CLASS, splitChatError, USER_MESSAGE_BUBBLE_CLASS } from "@/features/chat/components/messagePresentation";
import { useClickOutside } from "@/shared/lib/useClickOutside";
import { MessageImageAttachments } from "@/features/chat/components/MessageImageAttachments";
import { RunMetadataFields } from "@/features/chat/components/RunMetadataFields";
import { MessageProcessTrace } from "@/features/chat/components/MessageProcessTrace";

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

/** assistant 回复底部的常驻低干扰运行元数据签名(模型/耗时/token),全指针类型直接可见。 */
export function MessageRunMetadataDisplay({
  metadata,
}: {
  metadata: MessageRunMetadata;
}) {
  const t = useTranslations("chat");

  if (!hasRunDetails(metadata)) return null;

  return (
    <div
      role="group"
      aria-label={t("responseDetails")}
      className="min-w-0 max-w-full"
    >
      <RunMetadataFields metadata={metadata} className="justify-start" />
    </div>
  );
}

interface ChatMessageItemProps {
  message: ChatMessage;
  isLast: boolean;
  isStreaming: boolean;
  model: string;
  /** 当前消息渐进应用的输出样式 cssClass；仅 assistant 接收。 */
  renderStyleClass?: string | null;
  /** 当前会话选用样式的渲染器类型(custom=流式结束后用内置解析器重渲;默认 streamdown)。 */
  renderStyleRenderer?: "streamdown" | "custom";
  /** 是否使用内置纸面样式（影响代码块表现）。 */
  isPaper?: boolean;
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
  isPaper,
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
    processTrace,
    processRuntime,
    attachments = [],
  } = message;
  const visibleRunMetadata = runMetadata && status !== "interrupted" && hasRunMetadata(runMetadata)
    ? runMetadata
    : undefined;
  const hasProcessTrace = Boolean(
    processTrace?.runs.at(-1)?.steps.length
      || processRuntime
      || reasoning
      || toolCalls?.length
      || searchResults?.length
      || (isStreaming && isLast),
  );

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

  // 重新生成换模型选择弹层(仅多模型时启用)
  const [regenOpen, setRegenOpen] = useState(false);

  // 质量反馈:本地乐观态 + 踩后原因菜单
  const [localFeedback, setLocalFeedback] = useState<MessageFeedback | undefined>(feedback);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackFailed, setFeedbackFailed] = useState(false);
  const [reasonMenuOpen, setReasonMenuOpen] = useState(false);
  const feedbackMenuRef = useRef<HTMLDivElement>(null);
  const feedbackRequestRef = useRef(0);

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

  // 重新生成换模型菜单容器
  const regenMenuRef = useRef<HTMLDivElement>(null);
  // 重生成菜单 / 踩原因菜单:document 级外部点击收起(避免 fixed 遮罩被祖先 stacking 影响)
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

  // 回顶触发器只在回复超过一屏时出现:短回复没有滚回顶部的需求,常驻只会混淆语义
  const messageBodyRef = useRef<HTMLDivElement>(null);
  const [showScrollTopTrigger, setShowScrollTopTrigger] = useState(false);
  useEffect(() => {
    const el = messageBodyRef.current;
    if (!el || role !== "assistant") return;
    const update = () => setShowScrollTopTrigger(el.offsetHeight > window.innerHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [role]);

  // 是否可弹出操作菜单(移动长按 / 桌面右键):至少有编辑或删除之一可用
  const canEdit = Boolean(publicId && onEdit && !isStreaming && !conversationStreaming);
  const canDelete = Boolean(publicId && onRequestDelete && !conversationStreaming);
  const canShowMenu = canEdit || canDelete;

  return (
    <div id={domId} className={clsx("group/message relative flex animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none scroll-mt-4", role === "user" ? "justify-end" : "justify-start")}>
      {role === "assistant" && showScrollTopTrigger && (
        <div className="absolute inset-y-0 -left-11 hidden w-7 @min-[54rem]:block">
          <button
            type="button"
            onClick={() => {
              if (!domId) return;
              document.getElementById(domId)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="ai-trigger sticky top-4 mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-sora-blue/10 bg-sora-blue/[0.04] cursor-pointer transition-colors hover:bg-sora-blue/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
            title={t("scrollToReplyTop")}
            aria-label={t("scrollToReplyTop")}
          >
            <ArrowUpToLine className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      <div ref={messageBodyRef} className={clsx("space-y-2", role === "user" ? "flex w-full max-w-[88%] flex-col items-end sm:max-w-[70%]" : "flex-1 min-w-0")}>
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
              className="w-full rounded-2xl bg-neutral-900 text-white   px-4 py-2.5 text-ui-reading leading-7 resize-none border border-sora-blue/40 focus:outline-none focus:border-sora-blue"
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
                className="ai-trigger inline-flex items-center gap-1 text-ui-caption font-semibold text-neutral-400 hover:text-neutral-600  transition-colors cursor-pointer"
              >
                <AIXIcon className="w-3 h-3" />
                <span>{t("editCancel")}</span>
              </button>
              <button
                type="button"
                disabled={!canSubmitEdit}
                onClick={submitEdit}
                className="ai-trigger inline-flex items-center gap-1 text-ui-caption font-semibold text-sora-blue hover:opacity-80 disabled:opacity-40 transition-opacity cursor-pointer"
              >
                <AICheckIcon className="w-3 h-3" />
                <span>{t("editSaveAndResend")}</span>
              </button>
            </div>
          </div>) : (<div className="flex w-full flex-col items-end gap-1.5">
            {content ? <MessageImageAttachments attachments={attachments} /> : null}
            <div className="group relative w-fit max-w-full">
              {!content ? <MessageImageAttachments attachments={attachments} /> : null}
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
                  /* 折叠态:底部渐隐带内嵌居中「展开」按钮。渐变层 pointer-events-none 让气泡其余区域
                     仍可点击切换;按钮自身恢复指针事件并 stopPropagation,避免与气泡 onClick 双触发。 */
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center bg-gradient-to-b from-transparent via-neutral-900/80 to-neutral-900 pb-1.5">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setUserMsgExpanded(true); }}
                      className="pointer-events-auto flex items-center gap-1 rounded-md px-2 py-0.5 text-ui-caption font-semibold text-white/70 hover:text-white transition-colors cursor-pointer"
                      aria-expanded={userMsgExpanded}
                    >
                      <ChevronDown className="w-3 h-3" aria-hidden="true" />
                      <span>{t("expandUserMessage")}</span>
                    </button>
                  </div>
                ) : null}
                {userMsgCanCollapse && userMsgExpanded ? (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setUserMsgExpanded(false); }}
                      className="flex items-center gap-1 rounded-md px-2 py-0.5 text-ui-caption font-semibold text-white/70 hover:text-white transition-colors cursor-pointer"
                      aria-expanded={userMsgExpanded}
                    >
                      <ChevronUp className="w-3 h-3" aria-hidden="true" />
                      <span>{t("collapseUserMessage")}</span>
                    </button>
                  </div>
                ) : null}
              </div>) : null}
              {publicId && onEdit && !isStreaming && !conversationStreaming && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(content);
                    setDraftAttachments(attachments);
                    setEditing(true);
                  }}
                  className="ai-trigger absolute -left-7 top-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity p-1 rounded text-neutral-400 hover:text-neutral-600  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
                  title={t("edit")}
                  aria-label={t("edit")}
                >
                  <AIPencilIcon className="w-3.5 h-3.5" />
                </button>
              )}
              {publicId && onRequestDelete && !conversationStreaming && (
                <button
                  type="button"
                  onClick={() => onRequestDelete?.(publicId)}
                  className="ai-trigger absolute -left-7 top-7 p-1 rounded opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 text-neutral-500 hover:text-danger  transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
                  title={t("delete")}
                  aria-label={t("delete")}
                >
                  <AITrash2Icon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>))
        ) : (
          /* Assistant 消息: 流式 markdown 渲染 */
          (<div className={clsx(
            ASSISTANT_MESSAGE_CLASS,
            renderStyleClass && `rs-${renderStyleClass}`,
          )}>
            <MessageProcessTrace
              content={content}
              reasoning={reasoning}
              toolCalls={toolCalls}
              searchResults={searchResults}
              processTrace={processTrace}
              processRuntime={processRuntime}
              isStreaming={isStreaming}
              isLast={isLast}
            />
            {content ? (() => {
              const { body, error } = splitChatError(content);
              return (
                <>
                  {body && (
                    <ErrorBoundary name="message-markdown" rawContent={body}>
                      <Markdown
                        content={body}
                        isStreaming={isStreaming && isLast}
                        renderer={renderStyleRenderer}
                        renderStyleClass={isPaper ? "paper" : null}
                        onPreview={onOpenArtifact}
                      />
                    </ErrorBoundary>
                  )}
                  {error && !hasProcessTrace && <p className="mt-2 text-ui-caption italic leading-5 text-danger ">{error}</p>}
                </>
              );
            })() : null}
          </div>)
        )}

        {/* 常驻运行元数据签名:模型/耗时/token 全端直接可见,不再藏进 hover 动作条或粗指针展开层 */}
        {role === "assistant" && publicId && !(isStreaming && isLast) && visibleRunMetadata && (
          <MessageRunMetadataDisplay metadata={visibleRunMetadata} />
        )}

        {role === "assistant" && publicId && !(isStreaming && isLast) && (
          <div className="flex min-w-0 max-w-full flex-col items-start gap-1 opacity-0 pointer-events-none transition-opacity duration-150 group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 [@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:opacity-100 motion-reduce:transition-none">
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1 gap-y-1">
            {versionInfo && versionInfo.total > 1 && onSwitchVersion && (
              <div className="inline-flex items-center gap-1 text-ui-caption font-medium text-ink-tertiary ">
                <button
                  onClick={() => onSwitchVersion(publicId, "prev")}
                  className="p-0.5 rounded hover:text-space-ink/75  hover:bg-nebula-silver/45  transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer disabled:opacity-30"
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
                  className="p-0.5 rounded hover:text-space-ink/75  hover:bg-nebula-silver/45  transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer disabled:opacity-30"
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
              className="ai-trigger touch-target inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-tertiary transition-colors duration-150 hover:bg-nebula-silver/45 hover:text-space-ink/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer disabled:opacity-40   "
              title={copied ? t("copied") : t("copy")}
              aria-label={copied ? t("copied") : t("copy")}
            >
              {copied ? (
                <AICheckIcon className="size-3.5 text-sora-blue" />
              ) : (
                <AICopyIcon className="size-3.5" />
              )}
            </button>
            {/* 质量反馈:icon-only 赞/踩,紧邻原因菜单,不改变其它操作语义 */}
            <div ref={feedbackMenuRef} className="relative inline-flex items-center gap-0.5">
              <button
                type="button"
                onClick={handleThumbsUp}
                disabled={feedbackPending}
                className={clsx(
                  "ai-trigger touch-target inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                  localFeedback?.rating === "up"
                    ? "text-sora-blue bg-sora-blue/10"
                    : "text-ink-tertiary hover:text-space-ink/75   hover:bg-nebula-silver/45 ",
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
                <AIThumbsUpIcon className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleThumbsDown}
                disabled={feedbackPending}
                className={clsx(
                  "ai-trigger touch-target inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                  localFeedback?.rating === "down"
                    ? "text-danger  bg-red-500/10"
                    : "text-ink-tertiary hover:text-space-ink/75   hover:bg-nebula-silver/45 ",
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
                <AIThumbsDownIcon className="w-3.5 h-3.5" />
              </button>
              {/* 已踩且菜单关闭:独立入口重开/改选原因,不触碰 rating / DB */}
              {localFeedback?.rating === "down" && !reasonMenuOpen && (
                <button
                  type="button"
                  onClick={() => setReasonMenuOpen((open) => !open)}
                  className="touch-target inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-tertiary hover:text-space-ink/75   hover:bg-nebula-silver/45  transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
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
                  className="absolute bottom-full mb-1.5 left-0 z-40 min-w-[9.5rem] rounded-md border border-morning-mist  bg-white  py-1 transition-opacity duration-150"
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
                            : "text-neutral-600  hover:bg-neutral-50 ",
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
                className="ai-trigger touch-target inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-tertiary transition-colors duration-150 hover:bg-nebula-silver/45 hover:text-space-ink/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer   "
                title={t("regenerate")}
                aria-label={t("regenerate")}
                aria-haspopup={models.length > 1 ? "listbox" : undefined}
                aria-expanded={models.length > 1 ? regenOpen : undefined}
              >
                <AIRefreshCwIcon className="size-3.5" />
              </button>
              {regenOpen && models.length > 1 && (
                <div className="absolute bottom-full mb-2 right-0 z-40 w-48 max-h-60 overflow-y-auto rounded-lg border border-morning-mist  bg-white  py-1 shadow-md">
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
                          : "text-neutral-600  hover:bg-neutral-50 ",
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
                className="inline-flex items-center gap-1 text-ui-caption font-medium text-ink-tertiary hover:text-space-ink/75   transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue rounded cursor-pointer"
                aria-label={t("continueGenerating")}
                title={t("continueGenerating")}
              >
                <CornerDownRight className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t("continueGenerating")}</span>
              </button>
            )}
            {visibleRunMetadata?.completedAt && (
              <time
                dateTime={visibleRunMetadata.completedAt}
                title={formatDateTimeLocal(visibleRunMetadata.completedAt)}
                className="inline-flex h-8 shrink-0 items-center font-mono text-ui-body tabular-nums text-ink-tertiary "
              >
                {formatDateTimeMinute(visibleRunMetadata.completedAt)}
              </time>
            )}
            </div>
          </div>
        )}
      </div>
      {role === "user" && menuOpen && canShowMenu && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="rounded-xl border border-morning-mist  bg-white  p-1.5 min-w-[160px] shadow-lg animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {canEdit && (
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setDraft(content); setEditing(true); }}
                className="ai-trigger flex items-center gap-2 w-full px-3 py-2 text-ui-body text-neutral-700  hover:bg-neutral-100  rounded-lg transition-colors cursor-pointer"
              >
                <AIPencilIcon className="w-4 h-4" />
                <span>{t("edit")}</span>
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => { setMenuOpen(false); if (publicId) onRequestDelete?.(publicId); }}
                className="ai-trigger flex items-center gap-2 w-full px-3 py-2 text-ui-body text-danger hover:bg-red-50  rounded-lg transition-colors cursor-pointer"
              >
                <AITrash2Icon className="w-4 h-4" />
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
