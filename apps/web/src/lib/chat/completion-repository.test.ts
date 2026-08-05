import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  isNull: vi.fn((field: unknown) => ({ op: "isNull", field })),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  findConversationMessage: vi.fn(),
  withConversationMessageWrite: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
  isNull: mocks.isNull,
}));
vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));
vi.mock("@/lib/chat/message-reference", () => ({
  findConversationMessage: mocks.findConversationMessage,
  withConversationMessageWrite: mocks.withConversationMessageWrite,
}));

import {
  CompletionConflictError,
  persistChatCompletion,
} from "@/lib/chat/completion-repository";

const schema = {
  conversations: {
    id: "conversations.id",
    userId: "conversations.userId",
  },
  messages: {
    id: "messages.id",
    conversationId: "messages.conversationId",
    role: "messages.role",
    deletedAt: "messages.deletedAt",
    content: "messages.content",
  },
  memoryExtractionJobs: { id: "memory_jobs.id" },
  runs: {
    runId: "runs.runId",
    conversationId: "runs.conversationId",
    userId: "runs.userId",
    status: "runs.status",
  },
};

const completedAt = new Date("2026-07-30T00:00:00.000Z");
const memoryJob = {
  id: "memory-job-1",
  runId: "run-1",
  conversationId: "conversation-1",
  userId: "user-1",
  messages: [
    { role: "user" as const, content: "hello" },
    { role: "assistant" as const, content: "world" },
  ],
};

const baseInput = {
  conversationId: "conversation-1",
  userId: "user-1",
  runId: "run-1",
  userMessageInternalId: "user-message-1",
  userContent: "hello",
  sourceIdInternal: "source-1",
  assistant: {
    kind: "insert" as const,
    publicId: "assistant-public-1",
    createdAt: new Date("2026-07-30T00:00:00.000Z"),
  },
  assistantText: "world",
  assistantReasoning: "reasoning",
  processTrace: { blocks: [] },
  terminalStatus: "success" as const,
  tokenUsage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
  durationMs: 250,
  completedAt,
  memoryJob,
};

function createTransaction(options?: {
  assistantRows?: { id: string }[];
  runRows?: { runId: string }[];
  failMemoryInsert?: boolean;
}) {
  const operations: string[] = [];
  const assistantRows = options?.assistantRows ?? [{ id: "assistant-internal-1" }];
  const runRows = options?.runRows ?? [{ runId: "run-1" }];

  const tx = {
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        if (table === schema.memoryExtractionJobs) {
          operations.push("memory");
          return options?.failMemoryInsert
            ? Promise.reject(new Error("memory insert failed"))
            : Promise.resolve(undefined);
        }
        operations.push("assistant");
        return {
          returning: vi.fn().mockResolvedValue(assistantRows),
          values,
        };
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((patch: Record<string, unknown>) => ({
        where: vi.fn((where: unknown) => {
          if (table === schema.conversations) {
            operations.push("conversation");
            return Promise.resolve(undefined);
          }
          if (table === schema.runs) {
            operations.push("run");
            return {
              returning: vi.fn().mockResolvedValue(runRows),
              patch,
              where,
            };
          }
          operations.push("assistant");
          return {
            returning: vi.fn().mockResolvedValue(assistantRows),
            patch,
            where,
          };
        }),
      })),
    })),
  };
  return { tx, operations };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue({ id: "db" });
  mocks.getSchema.mockReturnValue(schema);
  mocks.findConversationMessage.mockReset();
  mocks.findConversationMessage
    .mockResolvedValueOnce({ id: "user-message-1", role: "user", content: "hello" })
    .mockResolvedValueOnce({ id: "source-1", role: "assistant", content: "source" });
});

describe("persistChatCompletion", () => {
  it("原子写入 assistant、conversation 时间、memory intent 与 run 终态", async () => {
    const { tx, operations } = createTransaction();
    mocks.withConversationMessageWrite.mockImplementation(
      async (_db, _schema, _conversationId, _userId, operation) => operation(tx),
    );

    await expect(persistChatCompletion(baseInput)).resolves.toEqual({
      assistantMessageId: "assistant-internal-1",
      status: "success",
      tokenUsage: baseInput.tokenUsage,
      durationMs: 250,
      completedAt,
    });

    expect(operations).toEqual(["assistant", "conversation", "memory", "run"]);
    expect(mocks.withConversationMessageWrite).toHaveBeenCalledWith(
      { id: "db" },
      schema,
      "conversation-1",
      "user-1",
      expect.any(Function),
    );
    expect(mocks.eq).toHaveBeenCalledWith(schema.runs.runId, "run-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.runs.conversationId, "conversation-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.runs.userId, "user-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.runs.status, "running");
  });

  it("continue 使用原内容 CAS，且不写 memory intent", async () => {
    const { tx, operations } = createTransaction();
    mocks.withConversationMessageWrite.mockImplementation(
      async (_db, _schema, _conversationId, _userId, operation) => operation(tx),
    );

    await persistChatCompletion({
      ...baseInput,
      sourceIdInternal: null,
      assistant: {
        kind: "continue",
        internalId: "assistant-internal-1",
        publicId: "assistant-public-1",
        prefixText: "before ",
      },
      memoryJob: null,
    });

    expect(operations).toEqual(["assistant", "conversation", "run"]);
    expect(mocks.eq).toHaveBeenCalledWith(schema.messages.content, "before ");
    expect(mocks.isNull).toHaveBeenCalledWith(schema.messages.deletedAt);
  });

  it("父消息内容变化时在任何写入前拒绝", async () => {
    const { tx, operations } = createTransaction();
    mocks.findConversationMessage.mockReset().mockResolvedValueOnce({
      id: "user-message-1",
      role: "user",
      content: "changed",
    });
    mocks.withConversationMessageWrite.mockImplementation(
      async (_db, _schema, _conversationId, _userId, operation) => operation(tx),
    );

    await expect(persistChatCompletion(baseInput)).rejects.toBeInstanceOf(
      CompletionConflictError,
    );
    expect(operations).toEqual([]);
  });

  it("continue CAS 未命中时拒绝并依赖事务回滚", async () => {
    const { tx, operations } = createTransaction({ assistantRows: [] });
    mocks.withConversationMessageWrite.mockImplementation(
      async (_db, _schema, _conversationId, _userId, operation) => operation(tx),
    );

    await expect(persistChatCompletion({
      ...baseInput,
      sourceIdInternal: null,
      assistant: {
        kind: "continue",
        internalId: "assistant-internal-1",
        publicId: "assistant-public-1",
        prefixText: "before ",
      },
      memoryJob: null,
    })).rejects.toBeInstanceOf(CompletionConflictError);
    expect(operations).toEqual(["assistant"]);
  });

  it("memory intent 写入失败时不执行 run 终结", async () => {
    const { tx, operations } = createTransaction({ failMemoryInsert: true });
    mocks.withConversationMessageWrite.mockImplementation(
      async (_db, _schema, _conversationId, _userId, operation) => operation(tx),
    );

    await expect(persistChatCompletion(baseInput)).rejects.toThrow("memory insert failed");
    expect(operations).toEqual(["assistant", "conversation", "memory"]);
  });

  it("run 条件终结零行时拒绝并依赖事务回滚", async () => {
    const { tx, operations } = createTransaction({ runRows: [] });
    mocks.withConversationMessageWrite.mockImplementation(
      async (_db, _schema, _conversationId, _userId, operation) => operation(tx),
    );

    await expect(persistChatCompletion(baseInput)).rejects.toBeInstanceOf(
      CompletionConflictError,
    );
    expect(operations).toEqual(["assistant", "conversation", "memory", "run"]);
  });

  it("会话属主锁未命中时拒绝", async () => {
    mocks.withConversationMessageWrite.mockResolvedValue(null);

    await expect(persistChatCompletion(baseInput)).rejects.toBeInstanceOf(
      CompletionConflictError,
    );
  });

  it("拒绝跨 run 或跨属主的 memory intent", async () => {
    await expect(persistChatCompletion({
      ...baseInput,
      memoryJob: { ...memoryJob, runId: "other-run" },
    })).rejects.toBeInstanceOf(CompletionConflictError);

    expect(mocks.withConversationMessageWrite).not.toHaveBeenCalled();
  });
});
