import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  writeFallbackTitle: vi.fn(),
  dispatchConversationTitleJob: vi.fn(),
  prepareChatContext: vi.fn(),
  createRunId: vi.fn(),
  executeChatCompletion: vi.fn(),
  redactErrorMessage: vi.fn(),
  assertVisionModel: vi.fn(),
  insertMessageAttachments: vi.fn(),
  loadMessageAttachmentsByMessageIds: vi.fn(),
  normalizeAttachmentFileIds: vi.fn((value: unknown) => Array.isArray(value) ? value : []),
  resolveChatImageAttachments: vi.fn(),
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
vi.mock("@/lib/conversation-title/service", () => ({
  writeFallbackTitle: mocks.writeFallbackTitle,
}));
vi.mock("@/lib/conversation-title/dispatch", () => ({
  dispatchConversationTitleJob: mocks.dispatchConversationTitleJob,
}));
vi.mock("@/lib/chat/orchestrator", () => ({ prepareChatContext: mocks.prepareChatContext }));
vi.mock("@/lib/chat/run-lifecycle", () => ({ createRunId: mocks.createRunId }));
vi.mock("@/lib/chat/completion-coordinator", () => ({
  executeChatCompletion: mocks.executeChatCompletion,
}));
vi.mock("@/lib/redaction", () => ({ redactErrorMessage: mocks.redactErrorMessage }));
vi.mock("@/lib/chat/message-attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/message-attachments")>();
  return {
    ...actual,
    assertVisionModel: mocks.assertVisionModel,
    insertMessageAttachments: mocks.insertMessageAttachments,
    loadMessageAttachmentsByMessageIds: mocks.loadMessageAttachmentsByMessageIds,
    normalizeAttachmentFileIds: mocks.normalizeAttachmentFileIds,
    resolveChatImageAttachments: mocks.resolveChatImageAttachments,
  };
});

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
  },
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
    body: JSON.stringify(body ?? {
      conversationId: "conversation-1",
      model: "model-1",
      messages: [
        { role: "user", content: "question" },
        { role: "assistant", content: "prefix" },
      ],
      continueFromPublicId: "assistant-public-1",
    }),
    signal,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function mockContinuationDb() {
  mocks.getDb.mockResolvedValue({
    select: selectQueue([
      [{ id: "conversation-1", userId: "user-1", outputModeId: null }],
      [{
        id: "assistant-1",
        publicId: "assistant-public-1",
        conversationId: "conversation-1",
        parentId: "user-message-1",
        role: "assistant",
        content: "prefix",
        createdAt: new Date("2026-07-20T08:00:00.000Z"),
        deletedAt: null,
      }],
      [{
        id: "user-message-1",
        publicId: "user-public-1",
        conversationId: "conversation-1",
        role: "user",
        content: "question",
        createdAt: new Date("2026-07-20T07:00:00.000Z"),
        deletedAt: null,
      }],
    ]),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ id: "user-1" });
  mocks.getSchema.mockReturnValue(schema);
  mocks.createRunId.mockReturnValue("run-1");
  mocks.prepareChatContext.mockResolvedValue({
    irRequest: {
      model: "model-1",
      messages: [{ role: "user", content: "question" }],
      stream: true,
    },
    trace: { mode: "test" },
    searchBundle: null,
    ragStatus: null,
    compaction: null,
  });
  mocks.writeFallbackTitle.mockResolvedValue(null);
  mocks.dispatchConversationTitleJob.mockResolvedValue(true);
  mocks.redactErrorMessage.mockReturnValue("safe error");
  mocks.resolveChatImageAttachments.mockResolvedValue([]);
  mocks.loadMessageAttachmentsByMessageIds.mockResolvedValue(new Map());
  mocks.assertVisionModel.mockResolvedValue(undefined);
  mocks.insertMessageAttachments.mockResolvedValue(undefined);
  mocks.executeChatCompletion.mockImplementation(async ({ emit }) => {
    await emit({ type: "started" });
    await emit({ type: "text-delta", text: " answer" });
    await emit({
      type: "finish",
      metadata: {
        model: "model-1",
        tokenUsage: { totalTokens: 7 },
        durationMs: 25,
        completedAt: "2026-07-30T00:00:00.000Z",
      },
    });
    return {
      kind: "committed_success",
      assistantText: " answer",
      assistantReasoning: "",
    };
  });
});

describe("POST /api/chat coordinator adapter", () => {
  it("显式 Composer 请求快照优先于数据库且保留 null/off", async () => {
    mocks.getDb.mockResolvedValue({
      select: selectQueue([
        [{
          id: "conversation-1",
          userId: "user-1",
          outputModeId: "db-mode",
          composerState: { reasoningByModelId: { "model-1": "low" } },
        }],
        [{
          id: "assistant-1",
          publicId: "assistant-public-1",
          conversationId: "conversation-1",
          parentId: "user-message-1",
          role: "assistant",
          content: "prefix",
          createdAt: new Date("2026-07-20T08:00:00.000Z"),
          deletedAt: null,
        }],
        [{
          id: "user-message-1",
          publicId: "user-public-1",
          conversationId: "conversation-1",
          role: "user",
          content: "question",
          createdAt: new Date("2026-07-20T07:00:00.000Z"),
          deletedAt: null,
        }],
      ]),
    });

    const response = await POST(request({
      conversationId: "conversation-1",
      model: "model-1",
      modelId: "model-1",
      messages: [
        { role: "user", content: "question" },
        { role: "assistant", content: "prefix" },
      ],
      continueFromPublicId: "assistant-public-1",
      outputModeId: null,
      reasoning: "off",
    }) as never);
    await response.text();

    expect(mocks.prepareChatContext).toHaveBeenCalledWith(expect.objectContaining({
      conv: { outputModeId: null },
    }));
    expect(mocks.executeChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ reasoning: "off" }),
    }));
  });

  it("旧请求缺少 Composer 快照时回退数据库", async () => {
    mocks.getDb.mockResolvedValue({
      select: selectQueue([
        [{
          id: "conversation-1",
          userId: "user-1",
          outputModeId: "db-mode",
          composerState: { reasoningByModelId: { "model-1": "low" } },
        }],
        [{
          id: "assistant-1",
          publicId: "assistant-public-1",
          conversationId: "conversation-1",
          parentId: "user-message-1",
          role: "assistant",
          content: "prefix",
          createdAt: new Date("2026-07-20T08:00:00.000Z"),
          deletedAt: null,
        }],
        [{
          id: "user-message-1",
          publicId: "user-public-1",
          conversationId: "conversation-1",
          role: "user",
          content: "question",
          createdAt: new Date("2026-07-20T07:00:00.000Z"),
          deletedAt: null,
        }],
      ]),
    });

    const response = await POST(request({
      conversationId: "conversation-1",
      model: "model-1",
      modelId: "model-1",
      messages: [
        { role: "user", content: "question" },
        { role: "assistant", content: "prefix" },
      ],
      continueFromPublicId: "assistant-public-1",
    }) as never);
    await response.text();

    expect(mocks.prepareChatContext).toHaveBeenCalledWith(expect.objectContaining({
      conv: { outputModeId: "db-mode" },
    }));
    expect(mocks.executeChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ reasoning: "low" }),
    }));
  });

  it("拒绝非法 Composer 请求快照", async () => {
    const response = await POST(request({
      conversationId: "conversation-1",
      model: "model-1",
      messages: [{ role: "user", content: "question" }],
      outputModeId: 42,
      reasoning: "extreme",
    }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "输入区状态非法" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("续写复用 assistant 身份时间并传递 CAS 上下文", async () => {
    mockContinuationDb();

    const response = await POST(request() as never);
    const payload = await response.text();
    const identityFrames = payload
      .split("\n\n")
      .filter((frame) => frame.includes('"type":"assistant_message"'))
      .map((frame) => JSON.parse(frame.slice(6)) as Record<string, unknown>);

    expect(identityFrames).toEqual([{
      type: "assistant_message",
      publicId: "assistant-public-1",
      createdAt: "2026-07-20T08:00:00.000Z",
    }]);
    expect(payload).not.toContain('"type":"user_message"');
    expect(mocks.executeChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      userMessageInternalId: "user-message-1",
      assistant: {
        kind: "continue",
        internalId: "assistant-1",
        publicId: "assistant-public-1",
        prefixText: "prefix",
      },
    }));
  });

  it("保持全部 domain event 的 SSE wire 并让 DONE 紧跟 finish", async () => {
    mockContinuationDb();
    mocks.prepareChatContext.mockResolvedValue({
      irRequest: { model: "model-1", messages: [{ role: "user", content: "question" }] },
      trace: { mode: "test" },
      searchBundle: { hit: true, results: [{ title: "source" }] },
      ragStatus: "hit",
      compaction: { compacted: true, strategy: "summary", fallbackLevel: 1 },
    });
    mocks.executeChatCompletion.mockImplementation(async ({ emit }) => {
      await emit({ type: "started" });
      await emit({ type: "text-delta", text: "answer" });
      await emit({ type: "reasoning-delta", text: "thought" });
      await emit({ type: "tool-call", toolCallId: "tc-1", toolName: "search", args: { q: 1 } });
      await emit({ type: "tool-result", toolCallId: "tc-1", toolName: "search", result: {}, isError: false });
      await emit({
        type: "finish",
        metadata: { model: "model-1", durationMs: 10, completedAt: "2026-07-30T00:00:00.000Z" },
      });
      return { kind: "committed_success", assistantText: "answer", assistantReasoning: "thought" };
    });

    const response = await POST(request() as never);
    const payload = await response.text();
    const types = payload
      .split("\n\n")
      .filter((frame) => frame.startsWith("data: {") && frame.includes('"type"'))
      .map((frame) => (JSON.parse(frame.slice(6)) as { type: string }).type);

    expect(types).toEqual([
      "assistant_message",
      "search_result",
      "rag_search",
      "compact",
      "delta",
      "reasoning",
      "tool_call",
      "tool_result",
      "finish",
    ]);
    expect(payload.indexOf('"type":"finish"')).toBeLessThan(payload.indexOf("data: [DONE]"));
  });

  it("失败事件不由 adapter 补发 DONE", async () => {
    mockContinuationDb();
    mocks.executeChatCompletion.mockImplementation(async ({ emit }) => {
      await emit({ type: "started" });
      await emit({ type: "error", error: "生成失败", code: "generation_failed" });
      return { kind: "committed_failed", assistantText: "", assistantReasoning: "" };
    });

    const response = await POST(request() as never);
    const payload = await response.text();

    expect(payload).toContain('"type":"error"');
    expect(payload).not.toContain('"type":"finish"');
    expect(payload).not.toContain("[DONE]");
  });

  it("父引用在用户消息短事务中失效时不调用 coordinator", async () => {
    const insert = vi.fn();
    mocks.getDb.mockResolvedValue({
      select: selectQueue([
        [{ id: "conversation-1", userId: "user-1", outputModeId: null }],
        [{
          id: "assistant-1",
          publicId: "assistant-public-1",
          conversationId: "conversation-1",
          role: "assistant",
          content: "previous",
          deletedAt: null,
        }],
      ]),
      insert,
      transaction: vi.fn(async (operation) => operation({
        select: selectQueue([[{ id: "conversation-1" }], []]),
        insert,
      })),
    });

    const response = await POST(request({
      conversationId: "conversation-1",
      model: "model-1",
      messages: [{ role: "user", content: "next" }],
      parentPublicId: "assistant-public-1",
    }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "父消息不存在或不属于当前会话",
    });
    expect(insert).not.toHaveBeenCalled();
    expect(mocks.executeChatCompletion).not.toHaveBeenCalled();
  });

  it("附件校验失败时不进入用户消息事务", async () => {
    const transaction = vi.fn();
    mocks.getDb.mockResolvedValue({
      select: selectQueue([[{ id: "conversation-1", userId: "user-1", outputModeId: null }]]),
      transaction,
    });
    const { ChatAttachmentError } = await import("@/lib/chat/message-attachments");
    mocks.resolveChatImageAttachments.mockRejectedValue(new ChatAttachmentError("图片附件无效"));

    const response = await POST(request({
      conversationId: "conversation-1",
      model: "model-1",
      messages: [{ role: "user", content: "question" }],
      fileIds: ["file-1"],
    }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "图片附件无效" });
    expect(transaction).not.toHaveBeenCalled();
    expect(mocks.executeChatCompletion).not.toHaveBeenCalled();
  });

  it("普通发送只在 route 写 user，随后把完成责任交给 coordinator", async () => {
    const attachment = {
      fileId: "file-1",
      filename: "image.png",
      mime: "image/png",
      storagePath: "chat/file-1.png",
    };
    mocks.resolveChatImageAttachments.mockResolvedValue([attachment]);
    mocks.writeFallbackTitle.mockResolvedValue({ id: "title-job-1" });
    const userValues = vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([{ id: "user-message-1" }]),
    }));
    const userTx = {
      select: selectQueue([[{ id: "conversation-1" }]]),
      insert: vi.fn(() => ({ values: userValues })),
    };
    const transaction = vi.fn(async (operation) => operation(userTx));
    mocks.getDb.mockResolvedValue({
      select: selectQueue([[{ id: "conversation-1", userId: "user-1", outputModeId: null }]]),
      transaction,
    });

    const response = await POST(request({
      conversationId: "conversation-1",
      model: "model-1",
      messages: [{ role: "user", content: "question" }],
      fileIds: ["file-1"],
    }) as never);
    const payload = await response.text();

    expect(transaction).toHaveBeenCalledOnce();
    expect(userValues).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      role: "user",
      content: "question",
    }));
    expect(mocks.insertMessageAttachments).toHaveBeenCalledWith(
      userTx,
      schema,
      "user-message-1",
      [attachment],
    );
    expect(mocks.dispatchConversationTitleJob).toHaveBeenCalledWith("title-job-1");
    expect(mocks.executeChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      userMessageInternalId: "user-message-1",
      memoryMessages: [{ role: "user", content: "question" }],
      assistant: expect.objectContaining({ kind: "insert", createdAt: expect.any(Date) }),
    }));
    expect(payload).toContain('"type":"user_message"');
    expect(payload).toContain("[DONE]");
  });

  it("reader cancel 传播到 coordinator 的同一 AbortSignal", async () => {
    mockContinuationDb();
    const receivedSignal = deferred<AbortSignal>();
    mocks.executeChatCompletion.mockImplementation(async ({ signal }) => {
      receivedSignal.resolve(signal);
      if (!signal.aborted) {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      return { kind: "committed_interrupted", assistantText: "", assistantReasoning: "" };
    });

    const response = await POST(request() as never);
    const reader = response.body!.getReader();
    const signal = await receivedSignal.promise;

    await reader.cancel();

    expect(signal.aborted).toBe(true);
  });
});
