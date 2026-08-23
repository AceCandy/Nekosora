import type { ChatProcessPhase, ChatProcessStep } from "@nekusora/contracts/chat";
import type { ToolCallRecord } from "@/features/chat/model/types";

export type ResearchStage = "understand" | "context" | "reasoning" | "search" | "read";
export type ResearchStepStatus = "running" | "completed" | "warning" | "error";

export interface ResearchStep {
  id: ResearchStage;
  type: ResearchStage;
  status: ResearchStepStatus;
  query?: string;
}

export interface ResearchStatus {
  status: "running" | "completed" | "error";
  /** 是否发生过真实研究活动(搜索/推理/非搜索工具);仅 understand/context 的轻量准备不算,用于完成态是否展示研究摘要。 */
  hasResearchActivity: boolean;
  currentStage?: ResearchStage;
  durationMs?: number;
  sourceCount?: number;
  query?: string;
  partialSourceFailure: boolean;
  steps: ResearchStep[];
}

interface BuildResearchStatusInput {
  phase: ChatProcessPhase;
  canonicalSteps: ChatProcessStep[];
  toolCalls?: ToolCallRecord[];
  sourceCount: number;
  hasReasoning: boolean;
  startedAt?: string;
  firstContentAt?: string;
  endedAt?: string;
}

const CONTEXT_KINDS = new Set<ChatProcessStep["kind"]>([
  "attachments",
  "memory",
  "compaction",
  "rag",
]);

function getSearchQuery(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const query = (args as Record<string, unknown>).query;
  return typeof query === "string" && query.trim() ? query.trim() : undefined;
}

function statusFromRaw(statuses: Array<ChatProcessStep["status"] | ToolCallRecord["status"]>): ResearchStepStatus {
  if (statuses.some((status) => status === "running" || status === "calling")) return "running";
  const failed = statuses.filter((status) => status === "failed" || status === "interrupted" || status === "error").length;
  const completed = statuses.some((status) => status === "completed" || status === "done");
  if (failed > 0 && completed) return "warning";
  if (failed > 0) return "error";
  return "completed";
}

function durationBetween(startedAt?: string, endedAt?: string): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const duration = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

export function buildResearchStatus(input: BuildResearchStatusInput): ResearchStatus {
  const processActive = input.phase === "preparing" || input.phase === "processing";
  const hasActiveWork = input.canonicalSteps.some((step) => step.status === "running")
    || input.toolCalls?.some((call) => call.status === "calling")
    || false;
  const researchActive = processActive || hasActiveWork;
  const researchCompleted = input.phase === "answering" || input.phase === "completed" || Boolean(input.firstContentAt);
  const contextSteps = input.canonicalSteps.filter((step) => CONTEXT_KINDS.has(step.kind));
  const reasoningSteps = input.canonicalSteps.filter((step) => step.kind === "reasoning");
  const searchSteps = input.canonicalSteps.filter((step) => step.kind === "web_search");
  const nonSearchTools = input.toolCalls?.filter((call) => call.toolName !== "web_search") ?? [];
  const searchCalls = input.toolCalls?.filter((call) => call.toolName === "web_search") ?? [];
  const query = [...searchCalls].reverse().map((call) => getSearchQuery(call.args)).find(Boolean);
  const searchStatuses = [
    ...searchSteps.map((step) => step.status),
    ...searchCalls.map((call) => call.status),
  ];
  const successfulSearch = searchStatuses.some((status) => status === "completed" || status === "done");
  const failedSearch = searchStatuses.some((status) => status === "failed" || status === "interrupted" || status === "error");
  const partialSourceFailure = failedSearch && (successfulSearch || input.sourceCount > 0);
  const steps: ResearchStep[] = [];

  steps.push({
    id: "understand",
    type: "understand",
    status: input.phase === "preparing" && input.canonicalSteps.every((step) => step.status !== "running")
      ? "running"
      : "completed",
  });

  if (contextSteps.some((step) => step.status !== "skipped")) {
    steps.push({ id: "context", type: "context", status: statusFromRaw(contextSteps.map((step) => step.status)) });
  }

  if (reasoningSteps.length > 0 || input.hasReasoning || nonSearchTools.length > 0) {
    const statuses = [
      ...reasoningSteps.map((step) => step.status),
      ...nonSearchTools.map((call) => call.status),
    ];
    steps.push({
      id: "reasoning",
      type: "reasoning",
      status: statuses.length > 0 ? statusFromRaw(statuses) : processActive ? "running" : "completed",
    });
  }

  if (searchStatuses.length > 0) {
    steps.push({
      id: "search",
      type: "search",
      status: partialSourceFailure ? "warning" : statusFromRaw(searchStatuses),
      query,
    });
  }

  if (input.sourceCount > 0) {
    const reading = processActive
      && input.phase === "processing"
      && !searchStatuses.some((status) => status === "running" || status === "calling");
    steps.push({ id: "read", type: "read", status: reading ? "running" : "completed" });
  }

  let currentStage: ResearchStage | undefined;
  if (researchActive) {
    currentStage = [...steps].reverse().find((step) => step.status === "running")?.type;
    if (!currentStage && input.phase === "processing" && input.sourceCount > 0 && searchStatuses.length > 0) {
      currentStage = "read";
    }
    currentStage ??= steps.at(-1)?.type ?? "understand";
  }

  return {
    status: researchActive ? "running" : researchCompleted ? "completed" : "error",
    hasResearchActivity: Boolean(
      reasoningSteps.length > 0
      || input.hasReasoning
      || nonSearchTools.length > 0
      || searchStatuses.length > 0
      || input.sourceCount > 0
    ),
    currentStage,
    durationMs: durationBetween(input.startedAt, input.firstContentAt ?? input.endedAt),
    sourceCount: input.sourceCount || undefined,
    query,
    partialSourceFailure,
    steps,
  };
}
