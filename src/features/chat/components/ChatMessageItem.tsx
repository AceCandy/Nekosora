"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, RefreshCw, Loader2, User, Pencil, X, Check, Wrench, CheckCircle2, AlertCircle, ExternalLink, ChevronLeft, ChevronRight, Copy, Volume2, Square, Trash2, CornerDownRight } from "lucide-react";
import { clsx } from "clsx";
import { Markdown } from "@/shared/components/markdown/Markdown";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { useMessageSpeech, plainTextFromMarkdown } from "@/features/chat/hooks/useMessageSpeech";
import { ArtifactInline } from "@/features/artifacts/ArtifactInline";
import { HtmlPreviewFrame } from "@/features/artifacts/HtmlPreviewFrame";
import type { ChatMessage, ModelOption } from "@/features/chat/model/types";
import type { Artifact } from "@/features/artifacts/ArtifactPanel";

import { copyToClipboard } from "@/shared/lib/clipboard";

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
  onEdit?: (publicId: string, newContent: string, model: string) => void;
  /** 切换该 assistant 消息的版本(同级兄弟)。 */
  onSwitchVersion?: (publicId: string, direction: "prev" | "next") => void;
  /** 软删除一条消息(二次确认后调用)。 */
  onDelete?: (publicId: string) => void;
  /** 在 assistant 消息末尾续写生成。 */
  onContinue?: (publicId: string) => void;
  /** 可用模型列表(>1 时重新生成弹出换模型选择)。 */
  models?: ModelOption[];
  /** 挂到最外层的 DOM id,供外部跳转定位(scrollIntoView)。 */
  domId?: string;
}

export const ChatMessageItem = React.memo(function ChatMessageItem({
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
  onDelete,
  onContinue,
  models = [],
  domId,
}: ChatMessageItemProps) {
  const t = useTranslations("chat");
  const { role, content, reasoning, publicId, artifacts, trace, toolCalls, searchResults, versionInfo } = message;
  const hasReasoning = Boolean(reasoning);
  // html artifact 直接内联渲染(AMC 式),其余 kind 走折叠条
  const htmlArtifacts = artifacts?.filter((a) => a.kind === "html") ?? [];
  const otherArtifacts = artifacts?.filter((a) => a.kind !== "html") ?? [];

  // 用户消息编辑态
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);

  // 复制按钮反馈
  const [copied, setCopied] = useState(false);

  // 重新生成换模型选择弹层(仅多模型时启用)
  const [regenOpen, setRegenOpen] = useState(false);

  // 思考样式条弹层状态:点击样式条打开侧边浮层查看完整思考内容
  const [reasoningPanelOpen, setReasoningPanelOpen] = useState(false);

  // 思考耗时计时:reasoning 首次出现记开始时间;正文开始或流结束记结束时间
  const reasoningStartRef = useRef<number | null>(null);
  const reasoningEndRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  // 重新生成原地替换为新 assistant 占位时,重置思考计时与弹层状态
  useEffect(() => {
    reasoningStartRef.current = null;
    reasoningEndRef.current = null;
    setElapsed(null);
    setReasoningPanelOpen(false);
  }, [publicId]);

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
  useEffect(() => {
    if (reasoningScrollRef.current) {
      reasoningScrollRef.current.scrollLeft = reasoningScrollRef.current.scrollWidth;
    }
  }, [reasoning]);

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

  // 语音朗读:全局同时只朗读一条,朗读中按钮切换为停止态
  const { supported: ttsSupported, speakingId, speak, stop: stopSpeak } = useMessageSpeech();
  const isSpeaking = Boolean(publicId) && speakingId === publicId;
  const handleToggleSpeech = () => {
    if (!publicId || !content) return;
    if (isSpeaking) stopSpeak();
    else speak(publicId, plainTextFromMarkdown(content));
  };

  return (
    <div id={domId} className={clsx("flex gap-4 animate-in fade-in duration-200 scroll-mt-4", role === "user" ? "justify-end" : "justify-start")}>
      {role === "assistant" && (
        <div className="w-7 h-7 rounded-full border border-sora-blue/10 bg-sora-blue/[0.04] flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles className="w-3.5 h-3.5 text-sora-blue" aria-hidden="true" />
        </div>
      )}

      <div className={clsx("max-w-[82%] space-y-2", role === "user" ? "flex flex-col items-end" : "")}>
        {role === "user" ? (
          /* 用户消息: 可编辑文本气泡 */
          editing ? (
            <div className="w-full max-w-[480px] space-y-1.5">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (publicId && draft.trim() && onEdit) {
                      onEdit(publicId, draft, model);
                      setEditing(false);
                    }
                  }
                  if (e.key === "Escape") setEditing(false);
                }}
                rows={Math.min(8, Math.max(2, draft.split("\n").length))}
                className="w-full rounded-2xl bg-neutral-900 text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm leading-relaxed resize-none border border-sora-blue/40 focus:outline-none focus:border-sora-blue"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraft(content);
                    setEditing(false);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors cursor-pointer"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                  <span>{t("editCancel")}</span>
                </button>
                <button
                  type="button"
                  disabled={!draft.trim() || draft.trim() === content.trim()}
                  onClick={() => {
                    if (publicId && draft.trim() && onEdit) {
                      onEdit(publicId, draft, model);
                      setEditing(false);
                    }
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-sora-blue hover:opacity-80 disabled:opacity-40 transition-opacity cursor-pointer"
                >
                  <Check className="w-3 h-3" aria-hidden="true" />
                  <span>{t("editSaveAndResend")}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="group relative">
              <div className="rounded-2xl bg-neutral-900 text-white px-4 py-2.5 dark:bg-white dark:text-black shadow-none border border-transparent text-sm leading-relaxed whitespace-pre-wrap break-words">
                {content}
              </div>
              {publicId && onEdit && !isStreaming && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(content);
                    setEditing(true);
                  }}
                  className="absolute -left-7 top-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
                  title={t("edit")}
                  aria-label={t("edit")}
                >
                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
              {publicId && onDelete && !isStreaming && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t("deleteMessageConfirm"))) onDelete?.(publicId);
                  }}
                  className="absolute -left-7 top-7 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-neutral-400 hover:text-red-500 dark:hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
                  title={t("delete")}
                  aria-label={t("delete")}
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )
        ) : (
          /* Assistant 消息: 流式 markdown 渲染 */
          <div className={clsx(
            "text-neutral-800 dark:text-neutral-200 max-w-[75ch] text-sm leading-relaxed",
            renderStyleClass && `rs-${renderStyleClass}`,
          )}>
            {hasReasoning && (
              <div className="relative mb-2">
                {/* 思考单行:未吐字显「思考中」,吐字时一行横向滚动,完成后收成「已思考X秒」。点击弹窗看全文 */}
                <button
                  type="button"
                  onClick={() => setReasoningPanelOpen((v) => !v)}
                  className={clsx(
                    "flex items-center gap-1.5 w-full max-w-[75ch] rounded-md px-2.5 py-1 text-[11px] font-mono select-none text-neutral-400 dark:text-neutral-500 transition-colors hover:bg-neutral-50/70 dark:hover:bg-[#0d0f14]/20",
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
                  {/* 吐字区域:单行横向滚动,溢出省略,弱化 */}
                  {isReasoningActive && reasoning && (
                    <span
                      ref={reasoningScrollRef}
                      className="flex-1 min-w-0 overflow-x-hidden whitespace-nowrap text-neutral-400/70 dark:text-neutral-600"
                    >
                      {reasoning}
                    </span>
                  )}
                  <ChevronRight className={clsx("w-3 h-3 shrink-0 opacity-40 transition-transform", reasoningPanelOpen && "rotate-90")} aria-hidden="true" />
                </button>

                {/* 思考全文弹窗:点击单行后弹出,宽度对齐思考行,弱化样式 */}
                {reasoningPanelOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setReasoningPanelOpen(false)} />
                    <div className="absolute z-40 left-0 top-full mt-1 w-full max-w-[75ch] max-h-[50vh] overflow-y-auto rounded-lg border border-morning-mist dark:border-deep-space/60 bg-white dark:bg-space-ink p-3 shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-mono text-neutral-400 dark:text-neutral-500">
                          {reasoningDone ? t("thoughtFor", { seconds: elapsed }) : t("thinking")}
                        </span>
                        <button
                          type="button"
                          onClick={() => setReasoningPanelOpen(false)}
                          className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                          aria-label="关闭"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="text-[12px] text-neutral-500 dark:text-neutral-400 whitespace-pre-wrap break-words leading-relaxed">
                        {reasoning}
                      </div>
                    </div>
                  </>
                )}
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
                      <summary className="cursor-pointer hover:text-neutral-600 dark:hover:text-neutral-300 px-3 py-1.5 text-[11px] font-mono select-none flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue">
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
                        <div className="px-3 pb-1.5 pt-1 text-[11px] text-neutral-500 dark:text-neutral-400 border-t border-morning-mist dark:border-deep-space/60 font-mono break-all">
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
                />
              </ErrorBoundary>
            ) : isStreaming && isLast && !hasReasoning ? (
              <span className="inline-flex items-center gap-1.5 text-neutral-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                {t("thinking")}
              </span>
            ) : null}
          </div>
        )}

        {role === "assistant" && publicId && !isStreaming && (
          <div className="flex items-center gap-3 flex-wrap">
            {versionInfo && versionInfo.total > 1 && onSwitchVersion && (
              <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-400">
                <button
                  onClick={() => onSwitchVersion(publicId, "prev")}
                  className="p-0.5 rounded hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer disabled:opacity-30"
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
                  className="p-0.5 rounded hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer disabled:opacity-30"
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
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue rounded cursor-pointer disabled:opacity-40"
              aria-label={t("copy")}
            >
              {copied ? (
                <Check className="w-3 h-3 text-sora-blue" aria-hidden="true" />
              ) : (
                <Copy className="w-3 h-3" aria-hidden="true" />
              )}
              <span>{copied ? t("copied") : t("copy")}</span>
            </button>
            <div className="relative">
              <button
                onClick={() => {
                  if (models.length > 1) setRegenOpen((v) => !v);
                  else onRegenerate(publicId, model);
                }}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue rounded cursor-pointer"
                aria-label={t("regenerate")}
                aria-haspopup={models.length > 1 ? "listbox" : undefined}
                aria-expanded={models.length > 1 ? regenOpen : undefined}
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t("regenerate")}</span>
              </button>
              {regenOpen && models.length > 1 && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setRegenOpen(false)} />
                  <div className="absolute bottom-full mb-2 right-0 z-40 w-48 max-h-60 overflow-y-auto rounded-lg border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink py-1 shadow-md">
                    {models.map((m) => (
                      <button
                        key={m.name}
                        type="button"
                        onClick={() => {
                          onRegenerate(publicId, m.name);
                          setRegenOpen(false);
                        }}
                        className={clsx(
                          "block w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors",
                          m.name === model
                            ? "text-sora-blue font-semibold"
                            : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
                        )}
                      >
                        {m.displayName ?? m.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              disabled={!ttsSupported || !content}
              onClick={handleToggleSpeech}
              className={clsx(
                "inline-flex items-center gap-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue rounded",
                isSpeaking
                  ? "text-sora-blue cursor-pointer"
                  : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 cursor-pointer",
                (!ttsSupported || !content) && "cursor-not-allowed opacity-50",
              )}
              aria-label={isSpeaking ? t("stopReading") : t("readAloud")}
              title={!ttsSupported ? t("readAloudUnsupported") : isSpeaking ? t("stopReading") : t("readAloud")}
            >
              {isSpeaking ? (
                <Square className="w-3 h-3" aria-hidden="true" />
              ) : (
                <Volume2 className="w-3 h-3" aria-hidden="true" />
              )}
              <span>{isSpeaking ? t("stopReading") : t("readAloud")}</span>
            </button>
            <button
              type="button"
              onClick={() => onContinue?.(publicId)}
              disabled={!content}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue rounded cursor-pointer disabled:opacity-40"
              aria-label={t("continueGenerating")}
              title={t("continueGenerating")}
            >
              <CornerDownRight className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t("continueGenerating")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t("deleteMessageConfirm"))) onDelete?.(publicId);
              }}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-400 hover:text-red-500 dark:hover:text-red-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue rounded cursor-pointer"
              aria-label={t("delete")}
              title={t("delete")}
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t("delete")}</span>
            </button>
          </div>
        )}

        {role === "assistant" && htmlArtifacts.length > 0 && (
          <div className="space-y-2 max-w-[75ch]">
            {htmlArtifacts.map((a, i) => (
              <HtmlPreviewFrame
                key={i}
                html={a.content}
                title={a.title}
                onOpenPanel={() => onOpenArtifact(a)}
              />
            ))}
          </div>
        )}

        {role === "assistant" && otherArtifacts.length > 0 && (
          <ArtifactInline
            artifacts={otherArtifacts}
            onOpenPanel={onOpenArtifact}
          />
        )}

        {role === "assistant" && searchResults && searchResults.length > 0 && (
          <details className="text-[11px] border border-morning-mist dark:border-deep-space/80 rounded-md bg-neutral-50/30 dark:bg-[#0d0f14]/10 overflow-hidden max-w-[75ch]">
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
                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500 block truncate ml-5">{r.url}</span>
                </a>
              ))}
            </div>
          </details>
        )}

        {role === "assistant" && trace && (
          <details className="text-[11px] text-neutral-400 border border-morning-mist dark:border-deep-space/80 rounded-md bg-neutral-50/30 dark:bg-[#0d0f14]/10 overflow-hidden max-w-[75ch]">
            <summary className="cursor-pointer hover:text-neutral-600 dark:hover:text-neutral-300 px-3 py-1.5 font-mono select-none flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue">
              <span>
                🔍 {t("routeTrace")} (
                {trace.fullMessageCount != null && trace.fullMessageCount > (trace.sentMessageCount ?? 0)
                  ? `${trace.fullMessageCount}→${trace.sentMessageCount ?? 0}`
                  : `${trace.sentMessageCount ?? 0}`}{" "}
                {t("contextCount")} · {trace.sentTokenEstimate ?? trace.totalTokenEstimate ?? 0} {t("tokensUsed")})
              </span>
            </summary>
            <div className="px-3 pb-2 pt-0.5 space-y-1 font-mono text-[10px] text-neutral-450 dark:text-neutral-500 border-t border-morning-mist dark:border-deep-space/60 mt-1">
              {trace.blocks?.map((b, bi) => (
                <div key={bi} className="flex justify-between gap-4">
                  <span>
                    <span className="text-neutral-400 dark:text-neutral-600">[{b.kind}]</span> {b.title}
                  </span>
                  <span className="font-semibold text-neutral-500">~{b.tokenEstimate}t</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {role === "user" && (
        <div className="w-7 h-7 rounded-full border border-morning-mist dark:border-deep-space bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center shrink-0 mt-0.5">
          <User className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" aria-hidden="true" />
        </div>
      )}
    </div>
  );
});
