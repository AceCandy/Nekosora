import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startRunStrict: vi.fn(),
  heartbeatRun: vi.fn(),
  finalizeRun: vi.fn(),
  irUsageToTokenUsage: vi.fn(),
  recordToolCallStart: vi.fn(),
  recordToolCallResult: vi.fn(),
  streamChat: vi.fn(),
  streamChatWithTools: vi.fn(),
  resolveMcpServers: vi.fn(),
  getChatUA: vi.fn(),
  persistChatCompletion: vi.fn(),
  createMemoryExtractionJob: vi.fn(),
  dispatchMemoryExtractionJob: vi.fn(),
  extractArtifacts: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
}));

vi.mock("@/lib/chat/run-lifecycle", () => ({
  startRunStrict: mocks.startRunStrict,
  heartbeatRun: mocks.heartbeatRun,
  finalizeRun: mocks.finalizeRun,
  irUsageToTokenUsage: mocks.irUsageToTokenUsage,
  recordToolCallStart: mocks.recordToolCallStart,
  recordToolCallResult: mocks.recordToolCallResult,
}));
vi.mock("@/lib/stream", () => ({
  streamChat: mocks.streamChat,
  streamChatWithTools: mocks.streamChatWithTools,
}));
vi.mock("@/lib/mcp/registry", () => ({ resolveMcpServers: mocks.resolveMcpServers }));
vi.mock("@/lib/system-settings/ua", () => ({ getChatUA: mocks.getChatUA }));
vi.mock("@/lib/chat/completion-repository", () => ({
  persistChatCompletion: mocks.persistChatCompletion,
}));
vi.mock("@/lib/memory/jobs", () => ({
  createMemoryExtractionJob: mocks.createMemoryExtractionJob,
}));
vi.mock("@/lib/memory/dispatch", () => ({
  dispatchMemoryExtractionJob: mocks.dispatchMemoryExtractionJob,
}));
vi.mock("@/lib/artifacts/extract", () => ({ extractArtifacts: mocks.extractArtifacts }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));

import { executeChatCompletion } from "@/lib/chat/completion-coordinator";

const completedAt = new Date("2026-07-30T00:00:00.000Z");
const memoryJob = {
  id: "memory-job-1",
  runId: "run-1",
  conversationId: "conversation-1",
  userId: "user-1",
  messages: [
    { role: "user" as const, content: "question" },
    { role: "assistant" as const, content: "answer" },
  ],
};

const baseInput = {
  ctx: { userId: "user-1", keyKind: null, source: "chat" as const },
  request: {
    model: "model-1",
    messages: [{ role: "user" as const, content: "question" }],
  },
  modelId: "model-id-1",
  runId: "run-1",
  conversationId: "conversation-1",
  userId: "user-1",
  userMessageInternalId: "user-message-1",
  userContent: "question",
  sourceIdInternal: null,
  assistant: {
    kind: "insert" as const,
    publicId: "assistant-public-1",
    createdAt: new Date("2026-07-30T00:00:00.000Z"),
  },
  processTrace: { mode: "test" },
  memoryMessages: [{ role: "user", content: "question" }],
  requestStartedAt: performance.now(),
};

function events(...items: unknown[]) {
  return (async function* () {
    for (const item of items) yield item;
  })();
}

function eventsWithTail(onTail: () => void, ...items: unknown[]) {
  return (async function* () {
    for (const item of items) yield item;
    onTail();
  })();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startRunStrict.mockResolvedValue(undefined);
  mocks.heartbeatRun.mockResolvedValue(undefined);
  mocks.finalizeRun.mockResolvedValue(undefined);
  mocks.irUsageToTokenUsage.mockImplementation((usage) => usage
    ? { totalTokens: usage.totalTokens }
    : null);
  mocks.resolveMcpServers.mockResolvedValue([]);
  mocks.getChatUA.mockResolvedValue("test-ua");
  mocks.createMemoryExtractionJob.mockReturnValue(memoryJob);
  mocks.dispatchMemoryExtractionJob.mockResolvedValue(true);
  mocks.extractArtifacts.mockReturnValue({ text: "", artifacts: [] });
  mocks.persistChatCompletion.mockImplementation(async (input) => ({
    assistantMessageId: "assistant-internal-1",
    status: input.terminalStatus,
    tokenUsage: input.tokenUsage,
    durationMs: input.durationMs,
    completedAt,
  }));
});

describe("executeChatCompletion", () => {
  it("仅在 success 事务提交后产生唯一 finish", async () => {
    mocks.streamChat.mockReturnValue(events(
      { type: "text-delta", text: "answer" },
      { type: "reasoning-delta", text: "thought" },
      { type: "finish", finishReason: "stop", usage: { totalTokens: 7 } },
    ));
    const emitted: unknown[] = [];

    const outcome = await executeChatCompletion({
      ...baseInput,
      signal: new AbortController().signal,
      emit: async (event) => {
        emitted.push(event);
      },
    });

    expect(outcome.kind).toBe("committed_success");
    expect(emitted.map((event) => (event as { type: string }).type)).toEqual([
      "started",
      "text-delta",
      "reasoning-delta",
      "finish",
    ]);
    expect(mocks.persistChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      assistantText: "answer",
      assistantReasoning: "thought",
      terminalStatus: "success",
      tokenUsage: { totalTokens: 7 },
      memoryJob,
    }));
    expect(mocks.dispatchMemoryExtractionJob).toHaveBeenCalledWith("memory-job-1");
  });

  it.each([
    [
      "finish",
      { type: "finish", finishReason: "stop", usage: { totalTokens: 7 } },
      "committed_success",
    ],
    [
      "error",
      { type: "error", error: "upstream failed", code: "generation_failed" },
      "committed_failed",
    ],
  ] as const)("终态 %s 后推进 stream iterator 完成内层收尾", async (_label, terminalEvent, expectedKind) => {
    const tail = vi.fn();
    mocks.streamChat.mockReturnValue(eventsWithTail(tail, terminalEvent));

    await expect(executeChatCompletion({
      ...baseInput,
      signal: new AbortController().signal,
      emit: vi.fn(),
    })).resolves.toMatchObject({ kind: expectedKind });

    expect(tail).toHaveBeenCalledOnce();
  });

  it("strict run 启动失败时不调用模型与 repository", async () => {
    mocks.startRunStrict.mockRejectedValue(new Error("start failed"));
    const emitted: unknown[] = [];

    const outcome = await executeChatCompletion({
      ...baseInput,
      signal: new AbortController().signal,
      emit: async (event) => {
        emitted.push(event);
      },
    });

    expect(outcome.kind).toBe("start_failed");
    expect(mocks.streamChat).not.toHaveBeenCalled();
    expect(mocks.persistChatCompletion).not.toHaveBeenCalled();
    expect(emitted).toEqual([expect.objectContaining({ type: "error" })]);
  });

  it("开始前已 Abort 时不创建 run", async () => {
    const abort = new AbortController();
    abort.abort();

    const outcome = await executeChatCompletion({
      ...baseInput,
      signal: abort.signal,
      emit: vi.fn(),
    });

    expect(outcome.kind).toBe("cancelled_before_start");
    expect(mocks.startRunStrict).not.toHaveBeenCalled();
  });

  it("error 先到时忽略迟到 finish 并提交 failed", async () => {
    mocks.streamChat.mockReturnValue(events(
      { type: "text-delta", text: "partial" },
      { type: "error", error: "upstream failed", code: "generation_failed" },
      { type: "finish", finishReason: "stop", usage: { totalTokens: 9 } },
    ));
    const emitted: unknown[] = [];

    const outcome = await executeChatCompletion({
      ...baseInput,
      signal: new AbortController().signal,
      emit: async (event) => {
        emitted.push(event);
      },
    });

    expect(outcome.kind).toBe("committed_failed");
    expect(mocks.persistChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      terminalStatus: "failed",
    }));
    expect(emitted.filter((event) => (event as { type: string }).type === "finish"))
      .toHaveLength(0);
    expect(emitted.filter((event) => (event as { type: string }).type === "error"))
      .toHaveLength(1);
  });

  it("自然 EOF 收敛为 interrupted 且不产生 finish", async () => {
    mocks.streamChat.mockReturnValue(events({ type: "text-delta", text: "partial" }));
    const emitted: unknown[] = [];

    const outcome = await executeChatCompletion({
      ...baseInput,
      signal: new AbortController().signal,
      emit: async (event) => {
        emitted.push(event);
      },
    });

    expect(outcome.kind).toBe("committed_interrupted");
    expect(mocks.persistChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      terminalStatus: "interrupted",
    }));
    expect(emitted.at(-1)).toMatchObject({ type: "error" });
  });

  it("Abort 先到时忽略随后到达的 finish", async () => {
    const abort = new AbortController();
    const release = deferred<void>();
    mocks.streamChat.mockReturnValue((async function* () {
      yield { type: "text-delta", text: "partial" };
      await release.promise;
      yield { type: "finish", finishReason: "stop", usage: { totalTokens: 9 } };
    })());
    const emitted: unknown[] = [];
    const executing = executeChatCompletion({
      ...baseInput,
      signal: abort.signal,
      emit: async (event) => {
        emitted.push(event);
      },
    });
    await vi.waitFor(() => expect(emitted).toContainEqual(
      expect.objectContaining({ type: "text-delta" }),
    ));

    abort.abort();
    release.resolve();
    const outcome = await executing;

    expect(outcome.kind).toBe("committed_interrupted");
    expect(emitted.some((event) => (event as { type: string }).type === "finish")).toBe(false);
  });

  it("上游 iterator 忽略 Abort 时 coordinator 仍能完成中断提交", async () => {
    const abort = new AbortController();
    const never = new Promise<void>(() => {});
    mocks.streamChat.mockReturnValue((async function* () {
      yield { type: "text-delta", text: "partial" };
      await never;
    })());
    const emitted: unknown[] = [];
    const executing = executeChatCompletion({
      ...baseInput,
      signal: abort.signal,
      emit: async (event) => {
        emitted.push(event);
      },
    });
    await vi.waitFor(() => expect(emitted).toContainEqual(
      expect.objectContaining({ type: "text-delta" }),
    ));

    abort.abort();
    const outcome = await Promise.race([
      executing,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);

    expect(outcome).toMatchObject({ kind: "committed_interrupted" });
    expect(mocks.persistChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      terminalStatus: "interrupted",
    }));
  });

  it("finish 先到后提交期间 Abort，DB 保持 success 且 transport 不再写", async () => {
    const abort = new AbortController();
    const commit = deferred<{
      assistantMessageId: string;
      status: "success";
      tokenUsage: null;
      durationMs: number;
      completedAt: Date;
    }>();
    mocks.streamChat.mockReturnValue(events(
      { type: "finish", finishReason: "stop", usage: {} },
    ));
    mocks.persistChatCompletion.mockReturnValue(commit.promise);
    const emitted: unknown[] = [];
    const executing = executeChatCompletion({
      ...baseInput,
      signal: abort.signal,
      emit: async (event) => {
        emitted.push(event);
      },
    });
    await vi.waitFor(() => expect(mocks.persistChatCompletion).toHaveBeenCalledOnce());

    abort.abort();
    commit.resolve({
      assistantMessageId: "assistant-internal-1",
      status: "success",
      tokenUsage: null,
      durationMs: 10,
      completedAt,
    });
    const outcome = await executing;

    expect(outcome.kind).toBe("committed_success");
    expect(mocks.persistChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      terminalStatus: "success",
    }));
    expect(emitted.some((event) => (event as { type: string }).type === "finish")).toBe(false);
  });

  it("completion commit 失败时 best-effort 标记 run failed 且无 finish", async () => {
    mocks.streamChat.mockReturnValue(events(
      { type: "finish", finishReason: "stop", usage: { totalTokens: 3 } },
    ));
    mocks.persistChatCompletion.mockRejectedValue(new Error("commit failed"));
    const emitted: unknown[] = [];

    const outcome = await executeChatCompletion({
      ...baseInput,
      signal: new AbortController().signal,
      emit: async (event) => {
        emitted.push(event);
      },
    });

    expect(outcome.kind).toBe("persistence_failed");
    expect(mocks.finalizeRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      status: "failed",
    }));
    expect(emitted.some((event) => (event as { type: string }).type === "finish")).toBe(false);
  });
});
