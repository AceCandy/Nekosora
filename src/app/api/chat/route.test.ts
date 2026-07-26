import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  streamChat: vi.fn(),
  streamChatWithTools: vi.fn(),
  getChatUA: vi.fn(),
  resolveMcpServers: vi.fn(),
  extractArtifacts: vi.fn(),
  getQueue: vi.fn(),
  writeFallbackTitle: vi.fn(),
  prepareChatContext: vi.fn(),
  createRunId: vi.fn(),
  finalizeRun: vi.fn(),
  heartbeatRun: vi.fn(),
  irUsageToTokenUsage: vi.fn(),
  recordToolCallResult: vi.fn(),
  recordToolCallStart: vi.fn(),
  resolveRunTerminalStatus: vi.fn(),
  startRun: vi.fn(),
  redactErrorMessage: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  isNull: vi.fn((field: unknown) => ({ op: "isNull", field })),
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: mocks.and,
  isNull: mocks.isNull,
}));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));
vi.mock("@/lib/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/stream", () => ({
  streamChat: mocks.streamChat,
  streamChatWithTools: mocks.streamChatWithTools,
}));
vi.mock("@/lib/system-settings/ua", () => ({ getChatUA: mocks.getChatUA }));
vi.mock("@/lib/mcp/registry", () => ({ resolveMcpServers: mocks.resolveMcpServers }));
vi.mock("@/lib/artifacts/extract", () => ({ extractArtifacts: mocks.extractArtifacts }));
vi.mock("@/lib/infra/queue", () => ({ getQueue: mocks.getQueue }));
vi.mock("@/lib/conversation-title/service", () => ({
  writeFallbackTitle: mocks.writeFallbackTitle,
}));
vi.mock("@/lib/chat/orchestrator", () => ({ prepareChatContext: mocks.prepareChatContext }));
vi.mock("@/lib/chat/run-lifecycle", () => ({
  createRunId: mocks.createRunId,
  finalizeRun: mocks.finalizeRun,
  heartbeatRun: mocks.heartbeatRun,
  irUsageToTokenUsage: mocks.irUsageToTokenUsage,
  recordToolCallResult: mocks.recordToolCallResult,
  recordToolCallStart: mocks.recordToolCallStart,
  resolveRunTerminalStatus: mocks.resolveRunTerminalStatus,
  startRun: mocks.startRun,
}));
vi.mock("@/lib/redaction", () => ({ redactErrorMessage: mocks.redactErrorMessage }));

import { POST } from "./route";

const schema = {
  conversations: {
    id: "conversations.id",
    userId: "conversations.userId",
  },
  messages: {
    id: "messages.id",
    publicId: "messages.publicId",
    conversationId: "messages.conversationId",
    deletedAt: "messages.deletedAt",
    role: "messages.role",
    content: "messages.content",
  },
  artifacts: "artifacts",
};

function queryReturning(rows: Record<string, unknown>[]) {
  const query = {
    where: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(rows.slice(0, 1))),
    for: vi.fn(() => Promise.resolve(rows)),
  };
  return query;
}

function selectQueue(responses: Record<string, unknown>[][]) {
  const queue = [...responses];
  return vi.fn(() => ({
    from: vi.fn(() => queryReturning(queue.shift() ?? [])),
  }));
}

function request(body?: Record<string, unknown>) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      body ?? {
        conversationId: "conversation-1",
        model: "model-1",
        messages: [
          { role: "user", content: "question" },
          { role: "assistant", content: "prefix" },
        ],
        continueFromPublicId: "assistant-public-1",
      },
    ),
  });
}

describe("POST /api/chat 消息引用并发收敛", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
    mocks.createRunId.mockReturnValue("run-1");
    mocks.resolveMcpServers.mockResolvedValue([]);
    mocks.getChatUA.mockResolvedValue("test-agent");
    mocks.prepareChatContext.mockResolvedValue({
      irRequest: {
        model: "model-1",
        messages: [{ role: "user", content: "question" }],
        stream: true,
      },
      trace: [],
      searchBundle: null,
      ragStatus: null,
      compaction: null,
    });
    mocks.startRun.mockResolvedValue(true);
    mocks.finalizeRun.mockResolvedValue(undefined);
    mocks.heartbeatRun.mockResolvedValue(undefined);
    mocks.writeFallbackTitle.mockResolvedValue(null);
    mocks.extractArtifacts.mockReturnValue({ artifacts: [] });
    mocks.getQueue.mockResolvedValue({ send: vi.fn().mockResolvedValue("job-1") });
    mocks.irUsageToTokenUsage.mockReturnValue(undefined);
    mocks.resolveRunTerminalStatus.mockImplementation(
      ({ persistenceFailed }: { persistenceFailed: boolean }) =>
        persistenceFailed ? "failed" : "success",
    );
    mocks.redactErrorMessage.mockImplementation(
      (_error: unknown, _secrets: unknown[], fallback: string) => fallback,
    );
    mocks.streamChat.mockImplementation(async function* () {
      yield { type: "text-delta", text: " continuation" };
      yield { type: "finish", usage: {} };
    });
  });

  it("生成后引用失效时发送错误且不发送 DONE", async () => {
    const outerSelect = selectQueue([
      [{ id: "conversation-1", userId: "user-1", outputModeId: null }],
      [{
        id: "assistant-1",
        publicId: "assistant-public-1",
        conversationId: "conversation-1",
        parentId: "user-message-1",
        role: "assistant",
        content: "prefix",
        deletedAt: null,
      }],
      [{
        id: "user-message-1",
        publicId: "user-public-1",
        conversationId: "conversation-1",
        role: "user",
        content: "question",
        deletedAt: null,
      }],
    ]);
    const transactionSelect = selectQueue([
      [{ id: "conversation-1" }],
      [],
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const db = {
      select: outerSelect,
      update: vi.fn(() => ({ set: updateSet })),
      transaction: vi.fn(
        async (operation: (tx: { select: typeof transactionSelect }) => Promise<unknown>) =>
          operation({ select: transactionSelect }),
      ),
    };
    mocks.getDb.mockResolvedValue(db);

    const response = await POST(request() as never);
    const payload = await response.text();

    expect(payload).toContain('"type":"error"');
    expect(payload).not.toContain("[DONE]");
    expect(mocks.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", status: "failed" }),
    );
  });

  it("续写内容版本已变化时按持久化失败收敛", async () => {
    const outerSelect = selectQueue([
      [{ id: "conversation-1", userId: "user-1", outputModeId: null }],
      [{
        id: "assistant-1",
        publicId: "assistant-public-1",
        conversationId: "conversation-1",
        parentId: "user-message-1",
        role: "assistant",
        content: "prefix",
        deletedAt: null,
      }],
      [{
        id: "user-message-1",
        publicId: "user-public-1",
        conversationId: "conversation-1",
        role: "user",
        content: "question",
        deletedAt: null,
      }],
    ]);
    const transactionSelect = selectQueue([
      [{ id: "conversation-1" }],
      [{
        id: "user-message-1",
        publicId: "user-public-1",
        conversationId: "conversation-1",
        role: "user",
        content: "question",
        deletedAt: null,
      }],
    ]);
    const returning = vi.fn().mockResolvedValue([]);
    const transactionWhere = vi.fn(() => ({ returning }));
    const transactionSet = vi.fn(() => ({ where: transactionWhere }));
    const transactionUpdate = vi.fn(() => ({ set: transactionSet }));
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const db = {
      select: outerSelect,
      update: vi.fn(() => ({ set: updateSet })),
      transaction: vi.fn(
        async (operation: (tx: {
          select: typeof transactionSelect;
          update: typeof transactionUpdate;
        }) => Promise<unknown>) => operation({
          select: transactionSelect,
          update: transactionUpdate,
        }),
      ),
    };
    mocks.getDb.mockResolvedValue(db);

    const response = await POST(request() as never);
    const payload = await response.text();

    expect(payload).toContain('"type":"error"');
    expect(payload).not.toContain("[DONE]");
    expect(mocks.eq).toHaveBeenCalledWith(schema.messages.content, "prefix");
    expect(mocks.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", status: "failed" }),
    );
  });

  it("等待写锁后父消息失效时不插入 user 消息", async () => {
    const outerSelect = selectQueue([
      [{ id: "conversation-1", userId: "user-1", outputModeId: null }],
      [{
        id: "assistant-1",
        publicId: "assistant-public-1",
        conversationId: "conversation-1",
        role: "assistant",
        content: "previous answer",
        deletedAt: null,
      }],
    ]);
    const transactionSelect = selectQueue([
      [{ id: "conversation-1" }],
      [],
    ]);
    const returning = vi.fn().mockResolvedValue([{ id: "user-message-2" }]);
    const values = vi.fn(() => ({ returning }));
    const insert = vi.fn(() => ({ values }));
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const db = {
      select: outerSelect,
      insert,
      update: vi.fn(() => ({ set: updateSet })),
      transaction: vi.fn(
        async (operation: (tx: { select: typeof transactionSelect }) => Promise<unknown>) =>
          operation({ select: transactionSelect }),
      ),
    };
    mocks.getDb.mockResolvedValue(db);
    mocks.writeFallbackTitle.mockResolvedValue(null);

    const response = await POST(request({
      conversationId: "conversation-1",
      model: "model-1",
      messages: [{ role: "user", content: "next question" }],
      parentPublicId: "assistant-public-1",
    }) as never);
    const payload = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(payload)).toEqual({ error: "父消息不存在或不属于当前会话" });
    expect(insert).not.toHaveBeenCalled();
    expect(mocks.prepareChatContext).not.toHaveBeenCalled();
  });

  it("引用有效时在两个短事务后完成正常发送", async () => {
    let markFinalizeStarted: () => void = () => {};
    const finalizeStarted = new Promise<void>((resolve) => {
      markFinalizeStarted = resolve;
    });
    let releaseFinalize: () => void = () => {};
    const finalizePending = new Promise<void>((resolve) => {
      releaseFinalize = resolve;
    });
    mocks.finalizeRun.mockImplementation(() => {
      markFinalizeStarted();
      return finalizePending;
    });

    const outerSelect = selectQueue([
      [{ id: "conversation-1", userId: "user-1", outputModeId: null }],
      [{
        id: "assistant-1",
        publicId: "assistant-public-1",
        conversationId: "conversation-1",
        role: "assistant",
        content: "previous answer",
        deletedAt: null,
      }],
    ]);
    const userTransactionSelect = selectQueue([
      [{ id: "conversation-1" }],
      [{
        id: "assistant-1",
        publicId: "assistant-public-1",
        conversationId: "conversation-1",
        role: "assistant",
        content: "previous answer",
        deletedAt: null,
      }],
    ]);
    const assistantTransactionSelect = selectQueue([
      [{ id: "conversation-1" }],
      [{
        id: "user-message-2",
        publicId: "user-public-2",
        conversationId: "conversation-1",
        role: "user",
        content: "next question",
        deletedAt: null,
      }],
    ]);
    const userReturning = vi.fn().mockResolvedValue([{ id: "user-message-2" }]);
    const userValues = vi.fn(() => ({ returning: userReturning }));
    const userInsert = vi.fn(() => ({ values: userValues }));
    const assistantValues = vi.fn().mockResolvedValue(undefined);
    const assistantInsert = vi.fn(() => ({ values: assistantValues }));
    const userTx = { select: userTransactionSelect, insert: userInsert };
    const assistantTx = { select: assistantTransactionSelect, insert: assistantInsert };
    const transaction = vi
      .fn()
      .mockImplementationOnce(
        async (operation: (tx: typeof userTx) => Promise<unknown>) => operation(userTx),
      )
      .mockImplementationOnce(
        async (operation: (tx: typeof assistantTx) => Promise<unknown>) => operation(assistantTx),
      );
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    mocks.getDb.mockResolvedValue({
      select: outerSelect,
      update: vi.fn(() => ({ set: updateSet })),
      transaction,
    });

    const response = await POST(request({
      conversationId: "conversation-1",
      model: "model-1",
      messages: [{ role: "user", content: "next question" }],
      parentPublicId: "assistant-public-1",
    }) as never);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let payload = "";
    for (let index = 0; index < 5; index += 1) {
      const chunk = await reader.read();
      expect(chunk.done).toBe(false);
      payload += decoder.decode(chunk.value, { stream: true });
    }
    expect(payload).not.toContain("[DONE]");

    let terminalReadSettled = false;
    const terminalRead = reader.read().then((chunk) => {
      terminalReadSettled = true;
      return chunk;
    });
    await finalizeStarted;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const doneArrivedBeforeFinalize = terminalReadSettled;
    releaseFinalize();
    const terminalChunk = await terminalRead;
    payload += decoder.decode(terminalChunk.value, { stream: true });
    payload += decoder.decode();

    expect(response.status).toBe(200);
    expect(doneArrivedBeforeFinalize).toBe(false);
    expect(payload).toContain("[DONE]");
    expect(payload).not.toContain('"type":"error"');
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(userValues).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: "assistant-1", role: "user" }),
    );
    expect(assistantValues).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: "user-message-2", role: "assistant" }),
    );
    for (const [conversationPatch] of updateSet.mock.calls) {
      expect(conversationPatch).not.toHaveProperty("generating");
    }
    expect(mocks.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", status: "success" }),
    );
  });

  it("生成期间每 30 秒续租且完成后停止心跳", async () => {
    vi.useFakeTimers();
    let markGenerationStarted: () => void = () => {};
    const generationStarted = new Promise<void>((resolve) => {
      markGenerationStarted = resolve;
    });
    let releaseGeneration: () => void = () => {};
    const generationPending = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    mocks.streamChat.mockImplementation(async function* () {
      markGenerationStarted();
      await generationPending;
      yield { type: "text-delta", text: " continuation" };
      yield { type: "finish", usage: {} };
    });

    const outerSelect = selectQueue([
      [{ id: "conversation-1", userId: "user-1", outputModeId: null }],
      [{
        id: "assistant-1",
        publicId: "assistant-public-1",
        conversationId: "conversation-1",
        parentId: "user-message-1",
        role: "assistant",
        content: "prefix",
        deletedAt: null,
      }],
      [{
        id: "user-message-1",
        publicId: "user-public-1",
        conversationId: "conversation-1",
        role: "user",
        content: "question",
        deletedAt: null,
      }],
    ]);
    const transactionSelect = selectQueue([
      [{ id: "conversation-1" }],
      [{
        id: "user-message-1",
        publicId: "user-public-1",
        conversationId: "conversation-1",
        role: "user",
        content: "question",
        deletedAt: null,
      }],
    ]);
    const returning = vi.fn().mockResolvedValue([{ id: "assistant-1" }]);
    const transactionWhere = vi.fn(() => ({ returning }));
    const transactionSet = vi.fn(() => ({ where: transactionWhere }));
    const transactionUpdate = vi.fn(() => ({ set: transactionSet }));
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    mocks.getDb.mockResolvedValue({
      select: outerSelect,
      update: vi.fn(() => ({ set: updateSet })),
      transaction: vi.fn(
        async (operation: (tx: {
          select: typeof transactionSelect;
          update: typeof transactionUpdate;
        }) => Promise<unknown>) => operation({
          select: transactionSelect,
          update: transactionUpdate,
        }),
      ),
    });

    const response = await POST(request() as never);
    const payloadPromise = response.text();
    await generationStarted;
    await vi.advanceTimersByTimeAsync(29_999);
    const callsBeforeInterval = mocks.heartbeatRun.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    const callsDuringGeneration = mocks.heartbeatRun.mock.calls.length;

    releaseGeneration();
    const payload = await payloadPromise;
    await vi.advanceTimersByTimeAsync(60_000);
    const callsAfterCompletion = mocks.heartbeatRun.mock.calls.length;
    vi.useRealTimers();

    expect(callsBeforeInterval).toBe(0);
    expect(callsDuringGeneration).toBe(1);
    expect(mocks.heartbeatRun).toHaveBeenCalledWith("run-1");
    expect(callsAfterCompletion).toBe(callsDuringGeneration);
    expect(payload).toContain("[DONE]");
  });
});
