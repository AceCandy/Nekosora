import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BEST_EFFORT_TIMEOUT_MS } from "@/lib/best-effort";

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
  dispatchConversationTitleJob: vi.fn(),
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
vi.mock("@/lib/conversation-title/dispatch", () => ({
  dispatchConversationTitleJob: mocks.dispatchConversationTitleJob,
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

function request(body?: Record<string, unknown>, signal?: AbortSignal) {
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
    signal,
  });
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function mockContinuationDb(options?: {
  activeUser?: Record<string, unknown> | null;
  conversationUpdate?: Promise<unknown>;
  finalWriteStarted?: () => void;
  finalWriteGate?: Promise<void>;
}) {
  const activeUser =
    options?.activeUser === undefined
      ? {
          id: "user-message-1",
          publicId: "user-public-1",
          conversationId: "conversation-1",
          role: "user",
          content: "question",
          deletedAt: null,
        }
      : options.activeUser;
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
    activeUser ? [activeUser] : [],
  ]);
  const returning = vi.fn().mockResolvedValue([{ id: "assistant-1" }]);
  const transactionWhere = vi.fn(() => ({ returning }));
  const transactionSet = vi.fn(() => ({ where: transactionWhere }));
  const transactionUpdate = vi.fn(() => ({ set: transactionSet }));
  const updateWhere = vi
    .fn()
    .mockReturnValue(options?.conversationUpdate ?? Promise.resolve(undefined));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  mocks.getDb.mockResolvedValue({
    select: outerSelect,
    update: vi.fn(() => ({ set: updateSet })),
    transaction: vi.fn(
      async (operation: (tx: {
        select: typeof transactionSelect;
        update: typeof transactionUpdate;
      }) => Promise<unknown>) => {
        options?.finalWriteStarted?.();
        if (options?.finalWriteGate) await options.finalWriteGate;
        return operation({
          select: transactionSelect,
          update: transactionUpdate,
        });
      },
    ),
  });
  return { updateWhere };
}

function mockPendingGeneration() {
  const started = deferred();
  const release = deferred();
  mocks.streamChat.mockImplementation(async function* () {
    started.resolve();
    await release.promise;
    yield { type: "text-delta", text: " continuation" };
    yield { type: "finish", usage: {} };
  });
  return { started: started.promise, release: release.resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

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
    mocks.dispatchConversationTitleJob.mockResolvedValue(true);
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
    const tokenUsage = { promptTokens: 10, completionTokens: 0 };
    mocks.irUsageToTokenUsage.mockReturnValue(tokenUsage);
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
    mocks.writeFallbackTitle.mockResolvedValue({
      id: "title-job-1",
      userId: "user-1",
      conversationId: "conversation-1",
      firstUserMessage: "next question",
      fallbackTitle: "next question",
      chatModel: "model-1",
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
    for (let index = 0; index < 3; index += 1) {
      const chunk = await reader.read();
      expect(chunk.done).toBe(false);
      payload += decoder.decode(chunk.value, { stream: true });
    }
    expect(payload).not.toContain("[DONE]");
    expect(payload).not.toContain('"type":"finish"');
    expect(payload).not.toContain('"type":"trace"');

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
    const doneChunk = await reader.read();
    payload += decoder.decode(doneChunk.value, { stream: true });
    payload += decoder.decode();

    expect(response.status).toBe(200);
    expect(doneArrivedBeforeFinalize).toBe(false);
    expect(payload).toContain("[DONE]");
    expect(payload).not.toContain('"type":"error"');
    expect(payload).not.toContain('"type":"trace"');
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(mocks.writeFallbackTitle).toHaveBeenCalledWith(
      "user-1",
      "conversation-1",
      "next question",
      "model-1",
      undefined,
    );
    expect(mocks.dispatchConversationTitleJob).toHaveBeenCalledWith("title-job-1");
    expect(userValues).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: "assistant-1", role: "user" }),
    );
    expect(assistantValues).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: "user-message-2", role: "assistant" }),
    );
    for (const [conversationPatch] of updateSet.mock.calls) {
      expect(conversationPatch).not.toHaveProperty("generating");
    }
    const finalizeParams = mocks.finalizeRun.mock.calls[0][0] as {
      runId: string;
      status: string;
      tokenUsage: typeof tokenUsage;
      durationMs: number;
      completedAt: Date;
    };
    expect(finalizeParams).toEqual(expect.objectContaining({
      runId: "run-1",
      status: "success",
      tokenUsage,
      durationMs: expect.any(Number),
      completedAt: expect.any(Date),
    }));
    expect(Number.isInteger(finalizeParams.durationMs)).toBe(true);
    expect(finalizeParams.durationMs).toBeGreaterThanOrEqual(0);

    const finishFrames = payload
      .split("\n\n")
      .filter((frame) => frame.includes('"type":"finish"'));
    expect(finishFrames).toHaveLength(1);
    const finishEvent = JSON.parse(finishFrames[0].slice(6)) as {
      type: string;
      metadata: Record<string, unknown>;
    };
    expect(finishEvent).toEqual({
      type: "finish",
      metadata: {
        model: "model-1",
        tokenUsage,
        durationMs: finalizeParams.durationMs,
        completedAt: finalizeParams.completedAt.toISOString(),
      },
    });
    expect(payload.indexOf(finishFrames[0])).toBeLessThan(payload.indexOf("data: [DONE]"));
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
    const heartbeatPending = deferred();
    mocks.heartbeatRun.mockReturnValue(heartbeatPending.promise);

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
    await vi.advanceTimersByTimeAsync(60_000);
    const callsWhileHeartbeatPending = mocks.heartbeatRun.mock.calls.length;
    heartbeatPending.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    const callsAfterHeartbeatSettled = mocks.heartbeatRun.mock.calls.length;

    releaseGeneration();
    const payload = await payloadPromise;
    await vi.advanceTimersByTimeAsync(60_000);
    const callsAfterCompletion = mocks.heartbeatRun.mock.calls.length;
    vi.useRealTimers();

    expect(callsBeforeInterval).toBe(0);
    expect(callsDuringGeneration).toBe(1);
    expect(callsWhileHeartbeatPending).toBe(1);
    expect(callsAfterHeartbeatSettled).toBe(2);
    expect(mocks.heartbeatRun).toHaveBeenCalledWith("run-1");
    expect(callsAfterCompletion).toBe(callsAfterHeartbeatSettled);
    expect(payload).toContain("[DONE]");
  });

  it("生成结束进入必要持久化时立即停止 heartbeat", async () => {
    vi.useFakeTimers();
    const finalWriteStarted = deferred();
    const finalWriteGate = deferred();
    mockContinuationDb({
      finalWriteStarted: finalWriteStarted.resolve,
      finalWriteGate: finalWriteGate.promise,
    });

    const response = await POST(request() as never);
    const payloadPromise = response.text();
    await finalWriteStarted.promise;
    await vi.advanceTimersByTimeAsync(60_000);
    const heartbeatCallsDuringPersistence = mocks.heartbeatRun.mock.calls.length;

    finalWriteGate.resolve();
    const payload = await payloadPromise;

    expect(heartbeatCallsDuringPersistence).toBe(0);
    expect(payload).toContain("[DONE]");
  });

  it("run 启动失败时不创建 heartbeat", async () => {
    vi.useFakeTimers();
    mocks.startRun.mockResolvedValue(false);
    mockContinuationDb();
    const generation = mockPendingGeneration();

    const response = await POST(request() as never);
    const payloadPromise = response.text();
    await generation.started;
    await vi.advanceTimersByTimeAsync(90_000);
    const heartbeatCalls = mocks.heartbeatRun.mock.calls.length;

    generation.release();
    const payload = await payloadPromise;

    expect(heartbeatCalls).toBe(0);
    expect(payload).toContain("[DONE]");
  });

  it("request abort 后立即停止后续 heartbeat 调度", async () => {
    vi.useFakeTimers();
    mockContinuationDb();
    const generation = mockPendingGeneration();
    const requestAbort = new AbortController();

    const response = await POST(request(undefined, requestAbort.signal) as never);
    const payloadPromise = response.text();
    await generation.started;
    await vi.advanceTimersByTimeAsync(30_000);
    const callsBeforeAbort = mocks.heartbeatRun.mock.calls.length;

    requestAbort.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    const callsAfterAbort = mocks.heartbeatRun.mock.calls.length;

    generation.release();
    await payloadPromise;

    expect(callsBeforeAbort).toBe(1);
    expect(callsAfterAbort).toBe(callsBeforeAbort);
  });

  it("stream start 前 request 已 abort 时不创建 heartbeat", async () => {
    vi.useFakeTimers();
    mockContinuationDb();
    const generation = mockPendingGeneration();
    const requestAbort = new AbortController();
    requestAbort.abort();

    const response = await POST(request(undefined, requestAbort.signal) as never);
    const payloadPromise = response.text();
    await generation.started;
    await vi.advanceTimersByTimeAsync(60_000);
    const heartbeatCalls = mocks.heartbeatRun.mock.calls.length;

    generation.release();
    await payloadPromise;

    expect(heartbeatCalls).toBe(0);
  });

  it("stream cancel 后立即停止后续 heartbeat 调度", async () => {
    vi.useFakeTimers();
    mockContinuationDb();
    const generation = mockPendingGeneration();
    const finalized = deferred();
    mocks.finalizeRun.mockImplementation(async () => {
      finalized.resolve();
    });

    const response = await POST(request() as never);
    const reader = response.body!.getReader();
    await generation.started;
    await vi.advanceTimersByTimeAsync(30_000);
    const callsBeforeCancel = mocks.heartbeatRun.mock.calls.length;

    await reader.cancel();
    await vi.advanceTimersByTimeAsync(60_000);
    const callsAfterCancel = mocks.heartbeatRun.mock.calls.length;

    generation.release();
    await finalized.promise;

    expect(callsBeforeCancel).toBe(1);
    expect(callsAfterCancel).toBe(callsBeforeCancel);
  });

  it("失败 fallback 更新时间挂起时在等待预算后 finalize 并关闭流", async () => {
    vi.useFakeTimers();
    const fallbackUpdate = deferred();
    const fallbackStarted = deferred();
    const { updateWhere } = mockContinuationDb({
      activeUser: null,
      conversationUpdate: fallbackUpdate.promise,
    });
    updateWhere.mockImplementation(() => {
      fallbackStarted.resolve();
      return fallbackUpdate.promise;
    });

    const response = await POST(request() as never);
    let streamSettled = false;
    const payloadPromise = response.text().then((payload) => {
      streamSettled = true;
      return payload;
    });
    await fallbackStarted.promise;
    await vi.advanceTimersByTimeAsync(BEST_EFFORT_TIMEOUT_MS);
    const settledAfterBudget = streamSettled;
    const finalizeCallsAfterBudget = mocks.finalizeRun.mock.calls.length;

    fallbackUpdate.resolve();
    const payload = await payloadPromise;

    expect(settledAfterBudget).toBe(true);
    expect(finalizeCallsAfterBudget).toBe(1);
    expect(payload).toContain('"type":"error"');
    expect(payload).not.toContain("[DONE]");
  });
});
