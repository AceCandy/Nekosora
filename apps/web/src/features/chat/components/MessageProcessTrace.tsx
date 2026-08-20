"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import type { ChatProcessPhase } from "@nekusora/contracts/chat";
import type { ChatMessage, ToolCallRecord } from "@/features/chat/model/types";
import {
  buildResearchStatus,
  type ResearchStage,
  type ResearchStepStatus,
} from "@/features/chat/model/researchProcess";
import {
  latestProcessRun,
  type ChatProcessRuntimeState,
} from "@/features/chat/model/processTrace";
import { Popover } from "@/shared/ui/Popover";

const RUNNING_STAGE_I18N: Record<ResearchStage, string> = {
  understand: "researchRunningUnderstand",
  context: "researchRunningContext",
  reasoning: "researchRunningReasoning",
  search: "researchRunningSearch",
  read: "researchRunningRead",
};

const STEP_I18N: Record<ResearchStage, string> = {
  understand: "researchStepUnderstand",
  context: "researchStepContext",
  reasoning: "researchStepReasoning",
  search: "researchStepSearch",
  read: "researchStepRead",
};

interface MessageProcessTraceProps {
  content: string;
  reasoning?: string;
  toolCalls?: ToolCallRecord[];
  searchResults?: ChatMessage["searchResults"];
  processTrace?: ChatMessage["processTrace"];
  processRuntime?: ChatProcessRuntimeState;
  isStreaming: boolean;
  isLast: boolean;
}

function formatDuration(durationMs: number): string {
  const seconds = durationMs / 1000;
  return (seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString()).replace(/\.0$/, "");
}

function sourceHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function TimelineIcon({ status }: { status: ResearchStepStatus }) {
  if (status === "running") {
    return <Sparkles className="size-4 text-sora-blue motion-safe:animate-pulse" aria-hidden="true" />;
  }
  if (status === "warning") {
    return <AlertTriangle className="size-4 text-warning " aria-hidden="true" />;
  }
  if (status === "error") {
    return <AlertCircle className="size-4 text-danger " aria-hidden="true" />;
  }
  return <Check className="size-4 text-success " aria-hidden="true" />;
}

export function MessageProcessTrace({
  content,
  reasoning,
  toolCalls,
  searchResults,
  processTrace,
  processRuntime,
  isStreaming,
  isLast,
}: MessageProcessTraceProps) {
  const t = useTranslations("chat");
  const historicalRun = latestProcessRun(processTrace);
  const phase: ChatProcessPhase = processRuntime?.phase
    ?? historicalRun?.phase
    ?? (isStreaming && isLast ? "preparing" : "completed");
  const canonicalSteps = processRuntime?.steps ?? historicalRun?.steps ?? [];
  const tracedSourceCount = canonicalSteps.reduce((count, step) => {
    if (step.kind === "sources") return Math.max(count, step.data?.count ?? 0);
    if (step.kind === "web_search") return Math.max(count, step.data?.citationCount ?? 0);
    return count;
  }, 0);
  const sourceCount = Math.max(searchResults?.length ?? 0, tracedSourceCount);
  const hasTrace = Boolean(
    canonicalSteps.length
    || reasoning
    || toolCalls?.length
    || searchResults?.length
    || (isStreaming && isLast),
  );
  const research = buildResearchStatus({
    phase,
    canonicalSteps,
    toolCalls,
    sourceCount,
    hasReasoning: Boolean(reasoning),
    startedAt: processRuntime?.startedAt ?? historicalRun?.startedAt,
    firstContentAt: processRuntime?.firstContentAt ?? historicalRun?.firstContentAt,
    endedAt: processRuntime?.endedAt ?? historicalRun?.endedAt,
  });
  const runId = processRuntime?.runId
    ?? historicalRun?.runId
    ?? `legacy:${toolCalls?.length ?? 0}:${searchResults?.length ?? 0}:${content.length}`;
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const currentRunRef = useRef(runId);
  const wasRunningRef = useRef(research.status === "running");

  useEffect(() => {
    if (currentRunRef.current !== runId) {
      currentRunRef.current = runId;
      wasRunningRef.current = research.status === "running";
      setExpanded(false);
      return;
    }
    if (wasRunningRef.current && research.status !== "running") setExpanded(false);
    wasRunningRef.current = research.status === "running";
  }, [research.status, runId]);

  useEffect(() => {
    if (!expanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      triggerRef.current?.focus();
      setExpanded(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [expanded]);

  if (!hasTrace) return null;

  const runningStage = research.currentStage ?? "understand";
  const terminalTitle = research.status === "completed"
    ? t("researchCompleted")
    : phase === "interrupted"
      ? t("researchInterrupted")
      : t("researchFailed");
  const errorMessage = content.match(/(?:^|\n\n)(\[错误\][\s\S]*)$/)?.[1];
  const hasError = Boolean(errorMessage);
  const cleanErrorMessage = errorMessage?.replace(/^\[错误\]\s*/, "");
  const summaryParts = [terminalTitle];
  if (research.sourceCount) summaryParts.push(t("researchSourceCount", { count: research.sourceCount }));
  if (!hasError && research.status !== "error" && research.durationMs !== undefined) {
    summaryParts.push(t("researchDuration", { seconds: formatDuration(research.durationMs) }));
  }
  const currentQuery = research.currentStage === "search" ? research.query : undefined;
  const runningWarning = research.status === "running" && research.partialSourceFailure;
  const summaryText = hasError || research.status === "error"
    ? `${terminalTitle}${cleanErrorMessage ? ` · ${cleanErrorMessage}` : ""}`
    : research.status === "running"
    ? runningWarning
      ? t("researchPartialFailure")
      : t(RUNNING_STAGE_I18N[runningStage])
    : summaryParts.join(" · ");

  return (
    <div className="mb-3 text-space-ink ">
      <Popover
        open={expanded}
        onClose={() => setExpanded(false)}
        panelClassName="animate-in fade-in duration-200 motion-reduce:animate-none max-h-[min(70vh,35rem)] w-[min(35rem,calc(100vw-1.5rem))] overflow-y-auto"
        trigger={(
          <button
            ref={triggerRef}
            type="button"
            aria-label={t("processTrace")}
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((value) => !value)}
            className="touch-target inline-flex min-h-11 max-w-full min-w-0 items-center gap-3 rounded-md border-0 bg-transparent px-1.5 py-2 text-left transition-colors duration-150 hover:bg-nebula-silver/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue "
          >
            <span className="min-w-0">
              <span
                data-shimmer={research.status === "running" && !runningWarning ? summaryText : undefined}
                className={clsx(
                  "block truncate text-ui-body font-medium",
                  research.status === "running" && !runningWarning && "research-status-shimmer",
                  (hasError || research.status === "error") && "text-danger italic ",
                )}
                aria-live="polite"
              >
                {summaryText}
              </span>
              {research.status === "running" && !runningWarning && currentQuery && (
                <span className="mt-0.5 block truncate text-ui-caption text-space-ink/60 ">
                  {currentQuery}
                </span>
              )}
              {research.status === "running" && runningStage === "read" && !runningWarning && (
                <span className="mt-0.5 block text-ui-caption text-space-ink/60 ">
                  {t("researchReadingReliableSources")}
                </span>
              )}
              {runningWarning && research.sourceCount ? (
                <span className="mt-0.5 block text-ui-caption text-space-ink/60 ">
                  {t("researchContinueWithSources", { count: research.sourceCount })}
                </span>
              ) : research.status === "running" && research.sourceCount && (
                <span className="mt-0.5 block text-ui-caption text-ink-tertiary ">
                  {t("researchReadCount", { count: research.sourceCount })}
                </span>
              )}
            </span>
          </button>
        )}
      >
        <div
          id={panelId}
          role="region"
          aria-label={t("processTrace")}
          className="animate-in fade-in slide-in-from-top-1 p-2.5 text-space-ink duration-200 motion-reduce:animate-none "
        >
          <ol className="space-y-2.5">
            {research.steps.map((step, index) => (
              <li
                key={step.id}
                className="relative grid min-w-0 grid-cols-[16px_1fr] gap-2.5 text-ui-caption animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
              >
                {index < research.steps.length - 1 && (
                  <span className="absolute left-[7px] top-5 h-[calc(100%+2px)] w-px bg-morning-mist " aria-hidden="true" />
                )}
                <TimelineIcon status={step.status} />
                <span className="min-w-0 pb-0.5">
                  <span className="block font-medium text-space-ink/75 ">
                    {step.type === "read" && research.sourceCount
                      ? t("researchStepRead", { count: research.sourceCount })
                      : t(STEP_I18N[step.type])}
                  </span>
                  {step.type === "search" && step.query && (
                    <span className="mt-0.5 block break-words text-ink-tertiary ">
                      {step.query}
                    </span>
                  )}
                  {step.type === "search" && research.partialSourceFailure && research.sourceCount && (
                    <span className="mt-0.5 block text-amber-700 ">
                      {t("researchPartialSources", { count: research.sourceCount })}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>

          {searchResults && searchResults.length > 0 && (
            <details className="group/sources mt-3 border-t border-morning-mist/60 pt-1 ">
              <summary className="touch-target flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-1.5 py-1 text-ui-caption font-medium text-space-ink/70 transition-colors duration-150 hover:text-space-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue  ">
                <span>{t("researchViewSources", { count: searchResults.length })}</span>
                <span className="flex items-center gap-1 text-ink-tertiary ">
                  <ChevronDown className="size-4 transition-transform duration-200 group-open/sources:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                </span>
              </summary>
              <div className="space-y-1 pb-1 pt-1 group-open/sources:animate-in group-open/sources:fade-in group-open/sources:slide-in-from-top-1 group-open/sources:duration-200 motion-reduce:animate-none">
                {searchResults.map((result, index) => (
                  <a
                    key={`${result.url}-${index}`}
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group/source flex min-h-12 min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-ui-caption transition-colors duration-150 hover:bg-nebula-silver/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue "
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-space-ink/80 ">
                        {result.title || sourceHostname(result.url)}
                      </span>
                      <span className="block truncate text-ink-tertiary ">
                        {sourceHostname(result.url)}
                      </span>
                      {result.snippet && (
                        <span className="block truncate text-ink-tertiary ">
                          {result.snippet}
                        </span>
                      )}
                    </span>
                    <ExternalLink className="size-3.5 shrink-0 text-space-ink/35 transition-colors group-hover/source:text-sora-blue " aria-hidden="true" />
                  </a>
                ))}
              </div>
            </details>
          )}
        </div>
      </Popover>
    </div>
  );
}
