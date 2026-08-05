import { and, eq, isNull } from "drizzle-orm";
import type { ProcessTrace, TokenUsage } from "@/db/types";
import type { MemoryExtractionJob } from "@/lib/memory/jobs";
import { getDb, getSchema } from "@/lib/infra/db";
import {
  findConversationMessage,
  withConversationMessageWrite,
} from "@/lib/chat/message-reference";
import type { RunTerminalStatus } from "@/lib/chat/run-lifecycle";

export type AssistantWrite =
  | {
      kind: "insert";
      publicId: string;
      createdAt: Date;
    }
  | {
      kind: "continue";
      internalId: string;
      publicId: string;
      prefixText: string;
    };

export interface PersistChatCompletionInput {
  conversationId: string;
  userId: string;
  runId: string;
  userMessageInternalId: string;
  userContent: string;
  sourceIdInternal?: string | null;
  assistant: AssistantWrite;
  assistantText: string;
  assistantReasoning: string;
  processTrace: ProcessTrace;
  terminalStatus: RunTerminalStatus;
  tokenUsage: TokenUsage | null;
  durationMs: number;
  completedAt: Date;
  memoryJob?: MemoryExtractionJob | null;
}

export interface PersistChatCompletionResult {
  assistantMessageId: string;
  status: RunTerminalStatus;
  tokenUsage: TokenUsage | null;
  durationMs: number;
  completedAt: Date;
}

/** 引用、终态或属主条件不再成立；调用方不得宣告成功。 */
export class CompletionConflictError extends Error {
  constructor() {
    super("聊天完成状态已失效");
    this.name = "CompletionConflictError";
  }
}

/**
 * 原子提交 Chat 核心完成事实。模型生成不进入本事务，事务只持有短会话行锁。
 */
export async function persistChatCompletion(
  input: PersistChatCompletionInput,
): Promise<PersistChatCompletionResult> {
  assertMemoryJobOwnership(input);
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const result = await withConversationMessageWrite(
    db,
    s,
    input.conversationId,
    input.userId,
    async (tx) => {
      await assertActiveReferences(tx, s, input);
      const assistantMessageId = await writeAssistant(tx, s, input);

      await tx
        .update(s.conversations)
        .set({ updatedAt: input.completedAt })
        .where(and(
          eq(s.conversations.id, input.conversationId),
          eq(s.conversations.userId, input.userId),
        ));

      if (input.memoryJob) {
        await tx.insert(s.memoryExtractionJobs).values(input.memoryJob);
      }

      const [terminalRun] = await tx
        .update(s.runs)
        .set({
          status: input.terminalStatus,
          tokenUsage: input.tokenUsage,
          durationMs: input.durationMs,
          completedAt: input.completedAt,
        })
        .where(and(
          eq(s.runs.runId, input.runId),
          eq(s.runs.conversationId, input.conversationId),
          eq(s.runs.userId, input.userId),
          eq(s.runs.status, "running"),
        ))
        .returning({ runId: s.runs.runId });
      if (!terminalRun) throw new CompletionConflictError();

      return {
        assistantMessageId,
        status: input.terminalStatus,
        tokenUsage: input.tokenUsage,
        durationMs: input.durationMs,
        completedAt: input.completedAt,
      };
    },
  );
  if (!result) throw new CompletionConflictError();
  return result;
}

function assertMemoryJobOwnership(input: PersistChatCompletionInput): void {
  const job = input.memoryJob;
  if (!job) return;
  if (
    input.assistant.kind === "continue"
    || job.runId !== input.runId
    || job.conversationId !== input.conversationId
    || job.userId !== input.userId
  ) {
    throw new CompletionConflictError();
  }
}

async function assertActiveReferences(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any,
  input: PersistChatCompletionInput,
): Promise<void> {
  const userMessage = await findConversationMessage(
    tx,
    s,
    input.conversationId,
    { id: input.userMessageInternalId },
  );
  const activeUserContent = typeof userMessage?.content === "string"
    ? userMessage.content
    : String(userMessage?.content ?? "");
  if (userMessage?.role !== "user" || activeUserContent !== input.userContent) {
    throw new CompletionConflictError();
  }

  if (input.sourceIdInternal) {
    const source = await findConversationMessage(
      tx,
      s,
      input.conversationId,
      { id: input.sourceIdInternal },
    );
    if (!source) throw new CompletionConflictError();
  }
}

async function writeAssistant(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any,
  input: PersistChatCompletionInput,
): Promise<string> {
  const messageStatus = input.terminalStatus === "success" ? "success" : "interrupted";
  if (input.assistant.kind === "continue") {
    const [updated] = await tx
      .update(s.messages)
      .set({
        content: input.assistant.prefixText + input.assistantText,
        reasoning: input.assistantReasoning || null,
        status: messageStatus,
        processTrace: input.processTrace,
        runId: input.runId,
      })
      .where(and(
        eq(s.messages.id, input.assistant.internalId),
        eq(s.messages.conversationId, input.conversationId),
        eq(s.messages.role, "assistant"),
        isNull(s.messages.deletedAt),
        eq(s.messages.content, input.assistant.prefixText),
      ))
      .returning({ id: s.messages.id });
    if (!updated) throw new CompletionConflictError();
    return String(updated.id);
  }

  const [inserted] = await tx
    .insert(s.messages)
    .values({
      conversationId: input.conversationId,
      publicId: input.assistant.publicId,
      parentId: input.userMessageInternalId,
      runId: input.runId,
      role: "assistant",
      content: input.assistantText,
      reasoning: input.assistantReasoning || null,
      status: messageStatus,
      processTrace: input.processTrace,
      createdAt: input.assistant.createdAt,
    })
    .returning({ id: s.messages.id });
  if (!inserted) throw new CompletionConflictError();
  return String(inserted.id);
}
