import type { ProcessTrace } from "@/db/types";
import type { MessageRunMetadata } from "@/features/chat/model/types";
import { extractArtifacts } from "@/lib/artifacts/extract";
import type { AssistantWrite } from "@/lib/chat/completion-repository";
import { persistChatCompletion } from "@/lib/chat/completion-repository";
import {
  finalizeRun,
  heartbeatRun,
  irUsageToTokenUsage,
  recordToolCallResult,
  recordToolCallStart,
  startRunStrict,
  type RunTerminalStatus,
} from "@/lib/chat/run-lifecycle";
import { withBestEffortTimeout } from "@/lib/best-effort";
import { getDb, getSchema } from "@/lib/infra/db";
import { dispatchMemoryExtractionJob } from "@/lib/memory/dispatch";
import { createMemoryExtractionJob } from "@/lib/memory/jobs";
import { resolveMcpServers } from "@/lib/mcp/registry";
import type { CallContext, IRRequest, IRUsage, StreamEvent } from "@/lib/providers/types";
import { redactErrorMessage } from "@/lib/redaction";
import { streamChat, streamChatWithTools } from "@/lib/stream";
import { getChatUA } from "@/lib/system-settings/ua";

const RUN_HEARTBEAT_INTERVAL_MS = 30_000;
const STREAM_ABORTED = Symbol("stream-aborted");

export type ChatCompletionEvent =
  | { type: "started" }
  | Extract<StreamEvent, { type: "text-delta" | "reasoning-delta" | "tool-call" | "tool-result" }>
  | Extract<StreamEvent, { type: "error" }>
  | { type: "finish"; metadata: MessageRunMetadata };

export type ChatCompletionOutcomeKind =
  | "cancelled_before_start"
  | "start_failed"
  | "committed_success"
  | "committed_failed"
  | "committed_interrupted"
  | "persistence_failed";

export interface ChatCompletionOutcome {
  kind: ChatCompletionOutcomeKind;
  assistantText: string;
  assistantReasoning: string;
}

export interface ExecuteChatCompletionInput {
  ctx: CallContext;
  request: IRRequest;
  modelId?: string;
  runId: string;
  conversationId: string;
  userId: string;
  userMessageInternalId: string;
  userContent: string;
  sourceIdInternal?: string | null;
  assistant: AssistantWrite;
  processTrace: ProcessTrace;
  memoryMessages: readonly { role: string; content: unknown }[];
  requestStartedAt: number;
  signal: AbortSignal;
  emit: (event: ChatCompletionEvent) => Promise<void> | void;
}

/** 严格收敛单次 Chat 生成；首个终态原因一旦记录便不可覆盖。 */
export async function executeChatCompletion(
  input: ExecuteChatCompletionInput,
): Promise<ChatCompletionOutcome> {
  if (input.signal.aborted) return emptyOutcome("cancelled_before_start");

  try {
    await startRunStrict({
      runId: input.runId,
      conversationId: input.conversationId,
      userId: input.userId,
      platformModelName: input.request.model,
    });
  } catch {
    if (!input.signal.aborted) {
      await input.emit({ type: "error", error: "生成任务启动失败" });
    }
    return emptyOutcome("start_failed");
  }

  const stopHeartbeat = startHeartbeat(input.runId, input.signal);
  let assistantText = "";
  let assistantReasoning = "";
  const terminal: { status: RunTerminalStatus | null } = { status: null };
  let finalUsage: IRUsage | undefined;
  let errorEmitted = false;
  const latch = (status: RunTerminalStatus) => {
    if (!terminal.status) terminal.status = status;
  };

  try {
    if (input.signal.aborted) {
      latch("interrupted");
    } else {
      await input.emit({ type: "started" });
      const mcpServers = await resolveMcpServers(input.ctx).catch(() => []);
      const userAgent = await getChatUA();
      const hasTools = mcpServers.some((server) => server.tools.length > 0);
      const stream = hasTools
        ? streamChatWithTools({
            ctx: input.ctx,
            request: input.request,
            mcpServers,
            runId: input.runId,
            cacheKey: input.conversationId,
            modelId: input.modelId,
            abortSignal: input.signal,
            userAgent,
          })
        : streamChat({
            ctx: input.ctx,
            request: input.request,
            runId: input.runId,
            cacheKey: input.conversationId,
            modelId: input.modelId,
            abortSignal: input.signal,
            userAgent,
          });

      const iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const next = await nextEventOrAbort(iterator, input.signal);
        if (next === STREAM_ABORTED) {
          latch("interrupted");
          closeIterator(iterator);
          break;
        }
        if (next.done) break;
        const event = next.value;
        if (event.type === "text-delta") {
          assistantText += event.text;
          await input.emit(event);
        } else if (event.type === "reasoning-delta") {
          assistantReasoning += event.text;
          await input.emit(event);
        } else if (event.type === "tool-call") {
          await recordToolCallStart({
            runId: input.runId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
          });
          await input.emit(event);
        } else if (event.type === "tool-result") {
          await recordToolCallResult({
            runId: input.runId,
            toolCallId: event.toolCallId,
            result: event.result,
            isError: event.isError,
          });
          await input.emit(event);
        } else if (event.type === "finish") {
          finalUsage = event.usage;
          latch("success");
          closeIterator(iterator);
          break;
        } else if (event.type === "error") {
          latch("failed");
          errorEmitted = true;
          await input.emit(event);
          closeIterator(iterator);
          break;
        }
      }
      if (!terminal.status) {
        latch("interrupted");
        if (!input.signal.aborted) {
          errorEmitted = true;
          await input.emit({ type: "error", error: "生成未正常完成" });
        }
      }
    }
  } catch (error) {
    if (input.signal.aborted) {
      latch("interrupted");
    } else {
      latch("failed");
      if (!errorEmitted) {
        errorEmitted = true;
        await input.emit({
          type: "error",
          error: redactErrorMessage(error, [], "内部错误"),
        });
      }
    }
  } finally {
    stopHeartbeat();
  }

  const settledStatus = terminal.status ?? "interrupted";
  const tokenUsage = irUsageToTokenUsage(finalUsage);
  const completedAt = new Date();
  const durationMs = Math.max(0, Math.round(performance.now() - input.requestStartedAt));
  const memoryJob = input.assistant.kind === "insert" && assistantText
    ? createMemoryExtractionJob({
        runId: input.runId,
        userId: input.userId,
        conversationId: input.conversationId,
        recentMessages: [
          ...input.memoryMessages,
          { role: "assistant", content: assistantText },
        ],
      })
    : null;

  let committed;
  try {
    committed = await persistChatCompletion({
      conversationId: input.conversationId,
      userId: input.userId,
      runId: input.runId,
      userMessageInternalId: input.userMessageInternalId,
      userContent: input.userContent,
      sourceIdInternal: input.sourceIdInternal,
      assistant: input.assistant,
      assistantText,
      assistantReasoning,
      processTrace: input.processTrace,
      terminalStatus: settledStatus,
      tokenUsage,
      durationMs,
      completedAt,
      memoryJob,
    });
  } catch {
    await finalizeRun({
      runId: input.runId,
      status: "failed",
      tokenUsage,
      durationMs,
      completedAt,
    });
    if (!input.signal.aborted && !errorEmitted) {
      await input.emit({ type: "error", error: "收尾持久化失败" });
    }
    return { kind: "persistence_failed", assistantText, assistantReasoning };
  }

  if (memoryJob) {
    void dispatchMemoryExtractionJob(memoryJob.id).catch((error) => {
      console.error(
        "[chat-completion] memory dispatch failed:",
        redactErrorMessage(error).slice(0, 200),
      );
    });
  }
  await persistArtifactsBestEffort(input, committed.assistantMessageId, assistantText);

  if (settledStatus === "success") {
    if (!input.signal.aborted) {
      const metadata: MessageRunMetadata = {
        model: input.request.model,
        durationMs: committed.durationMs,
        completedAt: committed.completedAt.toISOString(),
      };
      if (committed.tokenUsage) metadata.tokenUsage = committed.tokenUsage;
      await input.emit({ type: "finish", metadata });
    }
    return { kind: "committed_success", assistantText, assistantReasoning };
  }
  return {
    kind: settledStatus === "failed" ? "committed_failed" : "committed_interrupted",
    assistantText,
    assistantReasoning,
  };
}

function emptyOutcome(kind: "cancelled_before_start" | "start_failed"): ChatCompletionOutcome {
  return { kind, assistantText: "", assistantReasoning: "" };
}

function startHeartbeat(runId: string, signal: AbortSignal): () => void {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    signal.removeEventListener("abort", stop);
  };
  const timer = setInterval(() => {
    if (stopped || signal.aborted || inFlight) return;
    const pending = heartbeatRun(runId);
    inFlight = pending;
    const clear = () => {
      if (inFlight === pending) inFlight = null;
    };
    void pending.then(clear, clear);
  }, RUN_HEARTBEAT_INTERVAL_MS);
  timer.unref();
  signal.addEventListener("abort", stop, { once: true });
  return stop;
}

async function nextEventOrAbort(
  iterator: AsyncIterator<StreamEvent>,
  signal: AbortSignal,
): Promise<IteratorResult<StreamEvent> | typeof STREAM_ABORTED> {
  if (signal.aborted) return STREAM_ABORTED;
  let onAbort!: () => void;
  const aborted = new Promise<typeof STREAM_ABORTED>((resolve) => {
    onAbort = () => resolve(STREAM_ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function closeIterator(iterator: AsyncIterator<StreamEvent>): void {
  if (!iterator.return) return;
  void iterator.return().catch(() => undefined);
}

async function persistArtifactsBestEffort(
  input: ExecuteChatCompletionInput,
  assistantMessageId: string,
  assistantText: string,
): Promise<void> {
  if (!assistantText || input.assistant.kind === "continue") return;
  try {
    const { artifacts } = extractArtifacts(assistantText);
    if (artifacts.length === 0) return;
    await withBestEffortTimeout(async () => {
      const db = await getDb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = getSchema() as any;
      await db.insert(s.artifacts).values(artifacts.map((artifact) => ({
        messageId: assistantMessageId,
        conversationId: input.conversationId,
        userId: input.userId,
        kind: artifact.kind,
        title: artifact.title,
        language: artifact.language,
        content: artifact.content,
      })));
    });
  } catch (error) {
    console.error(
      "[chat-completion] artifact persistence failed:",
      redactErrorMessage(error).slice(0, 200),
    );
  }
}
