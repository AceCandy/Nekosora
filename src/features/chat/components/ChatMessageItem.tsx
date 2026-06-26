"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, RefreshCw, Loader2, User, Pencil, X, Check, Wrench, CheckCircle2, AlertCircle, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import { Markdown } from "@/shared/components/markdown/Markdown";
import { ArtifactInline } from "@/features/artifacts/ArtifactInline";
import { HtmlPreviewFrame } from "@/features/artifacts/HtmlPreviewFrame";
import type { ChatMessage } from "@/features/chat/model/types";
import type { Artifact } from "@/features/artifacts/ArtifactPanel";

interface ChatMessageItemProps {
  message: ChatMessage;
  isLast: boolean;
  isStreaming: boolean;
  model: string;
  onRegenerate: (publicId: string, model: string) => void;
  onOpenArtifact: (a: Artifact) => void;
  /** 编辑用户消息后重发(publicId 为被编辑 user 消息的稳定标识)。 */
  onEdit?: (publicId: string, newContent: string, model: string) => void;
  /** 切换该 assistant 消息的版本(同级兄弟)。 */
  onSwitchVersion?: (publicId: string, direction: "prev" | "next") => void;
}

export const ChatMessageItem = React.memo(function ChatMessageItem({
  message,
  isLast,
  isStreaming,
  model,
  onRegenerate,
  onOpenArtifact,
  onEdit,
  onSwitchVersion,
}: ChatMessageItemProps) {
  const t = useTranslations("chat");
  const { role, content, reasoning, publicId, artifacts, trace, toolCalls, searchResults, versionInfo } = message;
  // 流式期思考块默认展开,完成后默认折叠(由 details 的 open 属性控制)
  const reasoningActive = isStreaming && isLast;
  const hasReasoning = Boolean(reasoning);
  // html artifact 直接内联渲染(AMC 式),其余 kind 走折叠条
  const htmlArtifacts = artifacts?.filter((a) => a.kind === "html") ?? [];
  const otherArtifacts = artifacts?.filter((a) => a.kind !== "html") ?? [];

  // 用户消息编辑态
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);

  return (
    <div className={clsx("flex gap-4 animate-in fade-in duration-200", role === "user" ? "justify-end" : "justify-start")}>
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
            </div>
          )
        ) : (
          /* Assistant 消息: 流式 markdown 渲染 */
          <div className="text-neutral-800 dark:text-neutral-200 max-w-[75ch] text-sm leading-relaxed">
            {hasReasoning && (
              <details
                open={reasoningActive}
                className="mb-2 rounded-md border border-morning-mist dark:border-deep-space/80 bg-neutral-50/50 dark:bg-[#0d0f14]/20 overflow-hidden">
                <summary className="cursor-pointer hover:text-neutral-600 dark:hover:text-neutral-300 px-3 py-1.5 text-[11px] font-mono select-none flex items-center gap-1.5 text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue">
                  <Sparkles className="w-3 h-3" aria-hidden="true" />
                  <span>{t("thinking")}</span>
                </summary>
                <div className="px-3 pb-2 pt-1 text-[12px] text-neutral-500 dark:text-neutral-400 border-t border-morning-mist dark:border-deep-space/60 whitespace-pre-wrap break-words leading-relaxed">
                  {reasoning}
                </div>
              </details>
            )}
            {toolCalls && toolCalls.length > 0 && (
              <div className="mb-2 space-y-1">
                {toolCalls.map((tc, ti) => (
                  <details
                    key={ti}
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
                ))}
              </div>
            )}
            {content ? (
              <Markdown
                content={content}
                isStreaming={isStreaming && isLast}
              />
            ) : isStreaming && isLast ? (
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
              onClick={() => onRegenerate(publicId, model)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue rounded cursor-pointer"
              aria-label={t("regenerate")}
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              <span>{t("regenerate")}</span>
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
