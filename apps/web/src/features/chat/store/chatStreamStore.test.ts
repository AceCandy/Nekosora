import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeChatSSE: vi.fn(),
  handleStreamError: vi.fn(),
  createConversation: vi.fn(),
  getConversationTitleStateAction: vi.fn(),
  retryFromMessage: vi.fn(),
  editMessage: vi.fn(),
  continueMessage: vi.fn(),
  getMessageSiblings: vi.fn(),
  selectMessageVersion: vi.fn(),
}));

vi.mock("@/features/chat/model/sse", () => ({
  consumeChatSSE: mocks.consumeChatSSE,
  handleStreamError: mocks.handleStreamError,
}));
vi.mock("@/features/chat/actions/conversations", () => ({
  createConversation: mocks.createConversation,
  getConversationTitleStateAction: mocks.getConversationTitleStateAction,
}));
vi.mock("@/features/chat/actions/branch", () => ({
  retryFromMessage: mocks.retryFromMessage,
  editMessage: mocks.editMessage,
  getMessageSiblings: mocks.getMessageSiblings,
  selectMessageVersion: mocks.selectMessageVersion,
  softDeleteMessage: vi.fn(),
  continueMessage: mocks.continueMessage,
}));

import { NEW_CONVERSATION_KEY, useChatStreamStore } from "@/features/chat/store/chatStreamStore";
import type { ChatMessage, MessageRunMetadata, ToolCallRecord } from "@/features/chat/model/types";
import type { SSEHandlers } from "@/features/chat/model/sse";

const sendOptions = { model: "model-a", modelId: "model-id-a" };
const finishMetadata: MessageRunMetadata = {
  model: "Model A",
  tokenUsage: { promptTokens: 12, completionTokens: 0 },
  durationMs: 0,
  completedAt: "2026-07-27T08:09:10.000Z",
};

describe("chatStreamStore Composer 请求快照", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStreamStore.setState({
      runtimes: {},
      activeConversationId: null,
      optimisticConversation: null,
    });
    mocks.consumeChatSSE.mockResolvedValue("success");
    mocks.handleStreamError.mockReturnValue({ content: "[错误] request failed" });
    mocks.createConversation.mockResolvedValue("conversation-created");
    mocks.getConversationTitleStateAction.mockResolvedValue({
      title: "Created conversation",
      pending: false,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data: done\n\n")));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("进入新对话 runtime 时清除旧活动态且保留后台会话", () => {
    useChatStreamStore.setState({
      runtimes: {
        "conversation-old": {
          messages: [{ role: "assistant", content: "still running" }],
          streaming: true,
          abortController: null,
        },
      },
      activeConversationId: "conversation-old",
      optimisticConversation: {
        id: "conversation-old",
        title: "Old conversation",
        createdAt: 1,
      },
    });

    useChatStreamStore.getState().hydrate(NEW_CONVERSATION_KEY, []);

    const state = useChatStreamStore.getState();
    expect(state.activeConversationId).toBeNull();
    expect(state.runtimes["conversation-old"].streaming).toBe(true);
    expect(state.optimisticConversation?.id).toBe("conversation-old");
  });

  it("旧调用仍显式发送联网关闭，避免会话 true 覆盖本轮选择", async () => {
    await useChatStreamStore.getState().send("conversation-existing", "hello", sendOptions);

    const fetchMock = vi.mocked(fetch);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(request.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("outputModeId");
    expect(body).not.toHaveProperty("reasoning");
    expect(body.webSearch).toBe(false);
  });

  it("通过本地发送条件后立即通知 Composer 清空输入", async () => {
    let resolveRequest!: (response: Response) => void;
    const request = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const onRequestAccepted = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => request));

    const sending = useChatStreamStore.getState().send(
      "conversation-existing",
      "hello",
      sendOptions,
      { onRequestAccepted },
    );

    expect(onRequestAccepted).toHaveBeenCalledOnce();
    resolveRequest(new Response("data: done\n\n"));
    await sending;
  });

  it("未通过本地发送条件时不通知 Composer 清空输入", async () => {
    const onRequestAccepted = vi.fn();

    await useChatStreamStore.getState().send(
      "conversation-existing",
      "",
      sendOptions,
      { onRequestAccepted },
    );

    expect(onRequestAccepted).not.toHaveBeenCalled();
  });

  it("新 Composer 显式发送 null/off 并用完整 reasoning map 创建会话", async () => {
    await useChatStreamStore.getState().send(
      NEW_CONVERSATION_KEY,
      "hello",
      {
        model: "provider/model-a",
        modelId: "model-a",
        instructionCardIds: ["card-a"],
        webSearch: true,
        knowledgeBaseIds: ["kb-a"],
        createOptions: {
          outputModeId: null,
          renderStyleId: "style-a",
          reasoning: "off",
          reasoningByModelId: { "model-a": "off", "model-b": "high" },
        },
      },
    );

    expect(mocks.createConversation).toHaveBeenCalledWith("provider/model-a", {
      outputModeId: null,
      renderStyleId: "style-a",
      webSearch: true,
      cardIds: ["card-a"],
      kbIds: ["kb-a"],
      reasoningByModelId: { "model-a": "off", "model-b": "high" },
    });
    const fetchMock = vi.mocked(fetch);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      outputModeId: null,
      reasoning: "off",
    });
  });
});

describe("chatStreamStore finish metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStreamStore.setState({
      runtimes: {
        "conversation-finish": {
          messages: [],
          streaming: false,
          abortController: null,
        },
      },
      activeConversationId: "conversation-finish",
      optimisticConversation: null,
    });
    mocks.handleStreamError.mockReturnValue({ content: "[错误] request failed" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data: done\n\n")));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("普通发送在 finish 后即时回填 assistant 运行元数据", async () => {
    mocks.consumeChatSSE.mockImplementationOnce(
      async (_body: ReadableStream<Uint8Array>, handlers: SSEHandlers) => {
        handlers.onUserMessage?.("user-real", "2026-07-28T01:02:03.000Z");
        handlers.onAssistantMessage?.("assistant-real", "2026-07-28T01:02:04.000Z");
        handlers.onFinish?.(finishMetadata);
        return "success" as const;
      },
    );

    await useChatStreamStore
      .getState()
      .send("conversation-finish", "hello", sendOptions);

    const messages = useChatStreamStore.getState().runtimes["conversation-finish"].messages;
    expect(messages[0]).toMatchObject({
      role: "user",
      publicId: "user-real",
      createdAt: "2026-07-28T01:02:03.000Z",
    });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      publicId: "assistant-real",
      createdAt: "2026-07-28T01:02:04.000Z",
      runMetadata: finishMetadata,
      status: "success",
    });
  });

  it("编辑重发把 finish 元数据写入新 assistant", async () => {
    useChatStreamStore.setState({
      runtimes: {
        "conversation-finish": {
          messages: [
            { role: "user", publicId: "user-1", content: "old question" },
            {
              role: "assistant",
              publicId: "assistant-old",
              content: "old answer",
              runMetadata: { model: "Old Model" },
            },
          ],
          streaming: false,
          abortController: null,
        },
      },
    });
    mocks.editMessage.mockResolvedValue({
      messages: [{ role: "user", content: "new question" }],
      attachments: [],
    });
    mocks.consumeChatSSE.mockImplementationOnce(
      async (_body: ReadableStream<Uint8Array>, handlers: SSEHandlers) => {
        handlers.onAssistantMessage?.("assistant-new", "2026-07-28T02:00:00.000Z");
        handlers.onFinish?.(finishMetadata);
        return "success" as const;
      },
    );

    await useChatStreamStore.getState().editAndResend(
      "conversation-finish",
      "user-1",
      "new question",
      [],
      "model-a",
      "model-id-a",
    );

    expect(mocks.editMessage).toHaveBeenCalledWith(
      "conversation-finish",
      "user-1",
      "new question",
      [],
      "model-a",
      "model-id-a",
    );

    const messages = useChatStreamStore.getState().runtimes["conversation-finish"].messages;
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: "assistant",
      publicId: "assistant-new",
      createdAt: "2026-07-28T02:00:00.000Z",
      content: "",
      runMetadata: finishMetadata,
      status: "success",
    });
  });

  it("续写开始时清掉旧元数据,并用新 finish 覆盖", async () => {
    useChatStreamStore.setState({
      runtimes: {
        "conversation-finish": {
          messages: [{
            role: "assistant",
            publicId: "assistant-1",
            content: "partial",
            createdAt: "2026-07-28T03:00:00.000Z",
            status: "interrupted",
            runMetadata: { model: "Old Model", durationMs: 500 },
            searchResults: [{ title: "Old", url: "https://old.example", snippet: "old" }],
          }],
          streaming: false,
          abortController: null,
        },
      },
    });
    mocks.continueMessage.mockResolvedValue({
      messages: [{ role: "assistant", content: "partial" }],
    });
    mocks.consumeChatSSE.mockImplementationOnce(
      async (_body: ReadableStream<Uint8Array>, handlers: SSEHandlers) => {
        expect(
          useChatStreamStore.getState().runtimes["conversation-finish"].messages[0]
            .runMetadata,
        ).toBeUndefined();
        handlers.onAssistantMessage?.("assistant-1", "2026-07-27T03:00:00.000Z");
        handlers.onSearchCompleted?.(
          "search-new",
          [{ title: "New", url: "https://new.example", snippet: "new" }],
        );
        handlers.onFinish?.(finishMetadata);
        return "success" as const;
      },
    );

    await useChatStreamStore.getState().continueGeneration(
      "conversation-finish",
      "assistant-1",
      "model-a",
      "model-id-a",
    );

    expect(
      useChatStreamStore.getState().runtimes["conversation-finish"].messages[0],
    ).toMatchObject({
      publicId: "assistant-1",
      createdAt: "2026-07-27T03:00:00.000Z",
      status: "success",
      runMetadata: finishMetadata,
      searchResults: [
        { title: "Old", url: "https://old.example", snippet: "old" },
        { title: "New", url: "https://new.example", snippet: "new" },
      ],
    });
  });
});

describe("chatStreamStore terminal 状态收敛", () => {
  type StreamAction = "send" | "regenerate" | "edit" | "continue";
  const actions = ["send", "regenerate", "edit", "continue"] as const;
  const cases = actions.flatMap(
    (action) => (["success", "failed", "interrupted"] as const).map(
      (status) => [action, status] as const,
    ),
  );
  const key = "conversation-terminal";

  beforeEach(() => {
    vi.clearAllMocks();
    useChatStreamStore.setState({
      runtimes: {
        [key]: {
          messages: [
            { role: "user", publicId: "user-1", content: "question" },
            {
              role: "assistant",
              publicId: "assistant-1",
              content: "partial",
              status: "interrupted",
            },
          ],
          streaming: false,
          abortController: null,
        },
      },
      activeConversationId: key,
      optimisticConversation: null,
    });
    mocks.retryFromMessage.mockResolvedValue({
      newAssistantPublicId: "assistant-placeholder",
      parentPublicId: "user-1",
      messages: [{ role: "user", content: "question" }],
    });
    mocks.editMessage.mockResolvedValue({
      messages: [{ role: "user", content: "edited" }],
      attachments: [],
    });
    mocks.continueMessage.mockResolvedValue({
      messages: [{ role: "assistant", content: "partial" }],
    });
    mocks.handleStreamError.mockReturnValue({ content: "[错误] request failed" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data: done\n\n")));
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function runAction(
    action: StreamAction,
    result: "success" | "failed" | "interrupted" | Error,
  ) {
    mocks.consumeChatSSE.mockImplementationOnce(async (
      _body: ReadableStream<Uint8Array>,
      handlers: SSEHandlers,
    ) => {
      if (result !== "success") handlers.onError?.("生成失败");
      if (result instanceof Error) throw result;
      return result;
    });
    await invokeAction(action);
    return useChatStreamStore.getState().runtimes[key].messages.at(-1);
  }

  async function invokeAction(action: StreamAction) {
    if (action === "send") {
      await useChatStreamStore.getState().send(key, "next", sendOptions);
    } else if (action === "regenerate") {
      await useChatStreamStore.getState().regenerate(
        key,
        "assistant-1",
        "model-a",
        "model-id-a",
      );
    } else if (action === "edit") {
      await useChatStreamStore.getState().editAndResend(
        key,
        "user-1",
        "edited",
        [],
        "model-a",
        "model-id-a",
      );
    } else {
      await useChatStreamStore.getState().continueGeneration(
        key,
        "assistant-1",
        "model-a",
        "model-id-a",
      );
    }
  }

  it.each(cases)("%s 收到 terminal(%s) 后写入对应消息完整性状态", async (action, status) => {
    const message = await runAction(action, status);

    expect(message?.status).toBe(status === "success" ? "success" : "interrupted");
    if (status !== "success") {
      expect(message?.content).toContain("[错误] 生成失败");
      expect(message?.content.match(/\[错误\]/g)).toHaveLength(1);
    }
  });

  it.each(actions)("%s 遇到缺少终态的协议异常后标记 interrupted", async (action) => {
    const message = await runAction(action, new Error("Chat SSE 在 [DONE] 前结束"));

    expect(message?.status).toBe("interrupted");
    expect(message?.content.match(/\[错误\]/g)).toHaveLength(1);
  });

  it.each(actions)("%s 撤回工具轮临时正文且保留既有正文", async (action) => {
    mocks.consumeChatSSE.mockImplementationOnce(async (
      _body: ReadableStream<Uint8Array>,
      handlers: SSEHandlers,
    ) => {
      handlers.onDelta("search keywords");
      handlers.onContentRetract?.("search keywords");
      handlers.onDelta("final answer");
      return "success" as const;
    });

    await invokeAction(action);

    const message = useChatStreamStore.getState().runtimes[key].messages.at(-1);
    expect(message?.content).toBe(action === "continue" ? "partialfinal answer" : "final answer");
  });

  it.each(actions)("%s 按 toolCallId 收敛同名搜索并保存引用", async (action) => {
    mocks.consumeChatSSE.mockImplementationOnce(async (
      _body: ReadableStream<Uint8Array>,
      handlers: SSEHandlers,
    ) => {
      handlers.onToolCall?.("web_search", { query: "first" }, "tc-1");
      handlers.onToolCall?.("web_search", { query: "second" }, "tc-2");
      handlers.onSearchFailed?.("tc-1", "failed", [
        {
          backend: { type: "provider", id: "tavily", name: "Tavily" },
          outcome: "failed",
          durationMs: 9,
        },
        {
          backend: { type: "current-model", name: "Current model" },
          outcome: "unsupported",
          durationMs: 1,
        },
      ]);
      handlers.onSearchCompleted?.(
        "tc-2",
        [{
          title: "Source",
          url: "https://example.com",
          publishedAt: "2026-08-03T00:00:00.000Z",
        }],
        { type: "provider", id: "tavily", name: "Tavily" },
        [{
          backend: { type: "provider", id: "tavily", name: "Tavily" },
          outcome: "success",
          durationMs: 12,
        }],
      );
      handlers.onToolResult?.("web_search", false, "tc-2");
      return "success" as const;
    });

    await invokeAction(action);

    const message = useChatStreamStore.getState().runtimes[key].messages.at(-1);
    expect(message?.toolCalls).toEqual([
      {
        toolCallId: "tc-1",
        toolName: "web_search",
        args: { query: "first" },
        status: "error",
        statusDetail: "failed",
        searchAttempts: [
          {
            backend: { type: "provider", id: "tavily", name: "Tavily" },
            outcome: "failed",
          },
          {
            backend: { type: "current-model", name: "Current model" },
            outcome: "unsupported",
          },
        ],
      },
      {
        toolCallId: "tc-2",
        toolName: "web_search",
        args: { query: "second" },
        status: "done",
        searchBackend: { type: "provider", id: "tavily", name: "Tavily" },
        searchAttempts: [{
          backend: { type: "provider", id: "tavily", name: "Tavily" },
          outcome: "success",
        }],
      },
    ]);
    expect(message?.searchResults).toEqual([{
      title: "Source",
      url: "https://example.com",
      publishedAt: "2026-08-03T00:00:00.000Z",
    }]);
    expect(message?.searchBackends).toEqual([
      { type: "provider", id: "tavily", name: "Tavily" },
    ]);
  });
});

describe("chatStreamStore 会话标题轮询", () => {
  let conversationSeq = 0;
  let conversationId = "";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    conversationId = `conversation-title-${++conversationSeq}`;
    useChatStreamStore.setState({
      runtimes: {},
      activeConversationId: null,
      optimisticConversation: null,
    });
    mocks.createConversation.mockResolvedValue(conversationId);
    mocks.consumeChatSSE.mockResolvedValue("success");
    mocks.handleStreamError.mockReturnValue({ content: "[错误] request failed" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data: done\n\n")));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function sendFirstMessage() {
    await useChatStreamStore.getState().send(
      NEW_CONVERSATION_KEY,
      "这是第一句话",
      sendOptions,
    );
    await vi.advanceTimersByTimeAsync(0);
  }

  it("标题完成后更新乐观标题并停止轮询", async () => {
    mocks.getConversationTitleStateAction
      .mockResolvedValueOnce({ title: "这是第一句话", pending: true })
      .mockResolvedValueOnce({ title: "最终摘要标题", pending: false });

    await sendFirstMessage();
    expect(mocks.getConversationTitleStateAction).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(useChatStreamStore.getState().optimisticConversation).toMatchObject({
      id: conversationId,
      title: "最终摘要标题",
    });
    expect(mocks.getConversationTitleStateAction).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.getConversationTitleStateAction).toHaveBeenCalledTimes(2);
  });

  it("会话切换不停止原轮询且不串写其他标题", async () => {
    mocks.getConversationTitleStateAction
      .mockResolvedValueOnce({ title: "这是第一句话", pending: true })
      .mockResolvedValueOnce({ title: "原会话最终标题", pending: false });

    await sendFirstMessage();
    useChatStreamStore.setState({
      optimisticConversation: { id: "conversation-other", title: "其他会话", createdAt: 1 },
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(mocks.getConversationTitleStateAction).toHaveBeenNthCalledWith(2, conversationId);
    expect(useChatStreamStore.getState().optimisticConversation).toMatchObject({
      id: "conversation-other",
      title: "其他会话",
    });
  });

  it("临时查询失败后继续到标题完成", async () => {
    mocks.getConversationTitleStateAction
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ title: "最终摘要标题", pending: false });

    await sendFirstMessage();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mocks.getConversationTitleStateAction).toHaveBeenCalledTimes(2);
    expect(useChatStreamStore.getState().optimisticConversation?.title).toBe("最终摘要标题");
  });

  it("达到一分钟上限后停止轮询", async () => {
    mocks.getConversationTitleStateAction.mockResolvedValue({
      title: "这是第一句话",
      pending: true,
    });

    await sendFirstMessage();
    await vi.advanceTimersByTimeAsync(60_000);
    const callsAtDeadline = mocks.getConversationTitleStateAction.mock.calls.length;

    expect(callsAtDeadline).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.getConversationTitleStateAction).toHaveBeenCalledTimes(callsAtDeadline);
  });

  it("单次查询永久 pending 时仍在一分钟上限结束", async () => {
    mocks.getConversationTitleStateAction.mockReturnValue(new Promise(() => undefined));

    await sendFirstMessage();
    expect(mocks.getConversationTitleStateAction).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mocks.getConversationTitleStateAction).toHaveBeenCalledOnce();
  });
});

describe("chatStreamStore 附件消费边界", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStreamStore.setState({
      runtimes: {},
      activeConversationId: null,
      optimisticConversation: null,
    });
    mocks.consumeChatSSE.mockResolvedValue("success");
    mocks.handleStreamError.mockReturnValue({ content: "[错误] request failed" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("服务器接受请求后消费本轮 fileIds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("data: done\n\n"));
    const uploadAttachments = vi.fn().mockResolvedValue([
      { fileId: "file-1", filename: "one.png", mime: "image/png" },
    ]);
    const onAttachmentsConsumed = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.consumeChatSSE.mockImplementationOnce(async () => {
      expect(onAttachmentsConsumed).toHaveBeenCalledWith(["file-1"]);
      return "success" as const;
    });

    await useChatStreamStore.getState().send("conversation-1", "hello", sendOptions, {
      uploadAttachments,
      onAttachmentsConsumed,
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({ fileIds: ["file-1"] });
    expect(onAttachmentsConsumed).toHaveBeenCalledOnce();
    expect(onAttachmentsConsumed).toHaveBeenCalledWith(["file-1"]);
  });

  it("服务器未接受请求时保留附件", async () => {
    const onAttachmentsConsumed = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await useChatStreamStore.getState().send("conversation-1", "hello", sendOptions, {
      uploadAttachments: vi.fn().mockResolvedValue([
        { fileId: "file-1", filename: "one.png", mime: "image/png" },
      ]),
      onAttachmentsConsumed,
    });

    expect(onAttachmentsConsumed).not.toHaveBeenCalled();
  });

  it("响应已接受后 SSE 失败仍视为附件已消费", async () => {
    const onAttachmentsConsumed = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data: start\n\n")));
    mocks.consumeChatSSE.mockRejectedValue(new Error("stream interrupted"));

    await useChatStreamStore.getState().send("conversation-1", "hello", sendOptions, {
      uploadAttachments: vi.fn().mockResolvedValue([
        { fileId: "file-1", filename: "one.png", mime: "image/png" },
      ]),
      onAttachmentsConsumed,
    });

    expect(onAttachmentsConsumed).toHaveBeenCalledWith(["file-1"]);
  });

  it("任一上传失败时不创建消息也不调用 chat API", async () => {
    const fetchMock = vi.fn();
    const onRequestRejected = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await useChatStreamStore.getState().send("conversation-1", "caption", sendOptions, {
      hasAttachments: true,
      uploadAttachments: vi.fn().mockRejectedValue(new Error("upload failed")),
      onRequestRejected,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useChatStreamStore.getState().runtimes["conversation-1"].messages).toEqual([]);
    expect(onRequestRejected).toHaveBeenCalledWith("upload failed");
  });

  it("允许仅图片消息并把同一附件写入乐观消息与请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("data: done\n\n"));
    vi.stubGlobal("fetch", fetchMock);

    await useChatStreamStore.getState().send("conversation-1", "", sendOptions, {
      hasAttachments: true,
      uploadAttachments: vi.fn().mockResolvedValue([
        { fileId: "file-1", filename: "one.png", mime: "image/png" },
      ]),
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      fileIds: ["file-1"],
      messages: [{ role: "user", content: "" }],
    });
    expect(useChatStreamStore.getState().runtimes["conversation-1"].messages[0])
      .toMatchObject({
        role: "user",
        content: "",
        attachments: [{ fileId: "file-1", filename: "one.png", mime: "image/png" }],
      });
  });

  it("预流式 4xx 恢复原消息并保留附件", async () => {
    const original: ChatMessage[] = [
      { role: "assistant", content: "previous", publicId: "assistant-1" },
    ];
    useChatStreamStore.setState({
      runtimes: {
        "conversation-1": { messages: original, streaming: false, abortController: null },
      },
    });
    const onAttachmentsConsumed = vi.fn();
    const onRequestRejected = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "vision unsupported" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    await useChatStreamStore.getState().send("conversation-1", "caption", sendOptions, {
      hasAttachments: true,
      uploadAttachments: vi.fn().mockResolvedValue([
        { fileId: "file-1", filename: "one.png", mime: "image/png" },
      ]),
      onAttachmentsConsumed,
      onRequestRejected,
    });

    expect(useChatStreamStore.getState().runtimes["conversation-1"].messages).toEqual(original);
    expect(onAttachmentsConsumed).not.toHaveBeenCalled();
    expect(onRequestRejected).toHaveBeenCalledWith("vision unsupported");
  });
});

describe("chatStreamStore switchVersion toolCalls", () => {
  const key = "conversation-switch";
  const oldToolCalls: ToolCallRecord[] = [
    { toolName: "old-search", status: "done", args: { q: "old" } },
  ];
  const targetToolCalls: ToolCallRecord[] = [
    { toolName: "web-search", status: "done", args: { q: "v2" } },
  ];
  const targetSearchResults = [{ title: "v2", url: "https://v2.example", snippet: "source" }];

  function seedAssistant(extra?: Partial<ChatMessage>) {
    useChatStreamStore.setState({
      runtimes: {
        [key]: {
          messages: [
            {
              role: "assistant",
              publicId: "pub-v1",
              content: "version 1",
              toolCalls: oldToolCalls,
              reasoning: "old-reason",
              runMetadata: { model: "Model V1", durationMs: 1_500 },
              searchResults: [{ title: "t", url: "https://x", snippet: "s" }],
              ...extra,
            },
          ],
          streaming: false,
          abortController: null,
        },
      },
      activeConversationId: key,
      optimisticConversation: null,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectMessageVersion.mockResolvedValue(undefined);
    seedAssistant();
  });

  it("目标版本带 toolCalls 时恢复到 assistant", async () => {
    mocks.getMessageSiblings.mockResolvedValue({
      current: { publicId: "pub-v1", parentId: "user-1" },
      siblings: [
        { publicId: "pub-v1", content: "version 1", reasoning: null, branchReason: null },
        {
          publicId: "pub-v2",
          content: "version 2",
          createdAt: "2026-07-25T00:00:02.000Z",
          reasoning: "think-v2",
          branchReason: "retry",
          runMetadata: {
            model: "Model V2",
            tokenUsage: { completionTokens: 0 },
            durationMs: 0,
            completedAt: "2026-07-25T00:00:02.000Z",
          },
          toolCalls: targetToolCalls,
          searchResults: targetSearchResults,
        },
      ],
    });

    await useChatStreamStore.getState().switchVersion(key, "pub-v1", "next");

    const msg = useChatStreamStore.getState().runtimes[key].messages[0];
    expect(msg.publicId).toBe("pub-v2");
    expect(msg.content).toBe("version 2");
    expect(msg.createdAt).toBe("2026-07-25T00:00:02.000Z");
    expect(msg.reasoning).toBe("think-v2");
    expect(msg.runMetadata).toEqual({
      model: "Model V2",
      tokenUsage: { completionTokens: 0 },
      durationMs: 0,
      completedAt: "2026-07-25T00:00:02.000Z",
    });
    expect(msg.toolCalls).toEqual(targetToolCalls);
    expect(msg.searchResults).toEqual(targetSearchResults);
    expect(msg.versionInfo).toEqual({ current: 2, total: 2 });
  });

  it("目标版本不带 toolCalls 时为 undefined", async () => {
    mocks.getMessageSiblings.mockResolvedValue({
      current: { publicId: "pub-v1", parentId: "user-1" },
      siblings: [
        {
          publicId: "pub-v1",
          content: "version 1",
          reasoning: null,
          branchReason: null,
          toolCalls: oldToolCalls,
        },
        { publicId: "pub-v2", content: "version 2 plain", reasoning: null, branchReason: "retry" },
      ],
    });

    await useChatStreamStore.getState().switchVersion(key, "pub-v1", "next");

    const msg = useChatStreamStore.getState().runtimes[key].messages[0];
    expect(msg.publicId).toBe("pub-v2");
    expect(msg.toolCalls).toBeUndefined();
    expect(msg.runMetadata).toBeUndefined();
  });

  it("不能保留旧版本的 toolCalls", async () => {
    mocks.getMessageSiblings.mockResolvedValue({
      current: { publicId: "pub-v1", parentId: "user-1" },
      siblings: [
        {
          publicId: "pub-v1",
          content: "version 1",
          reasoning: null,
          branchReason: null,
          toolCalls: oldToolCalls,
        },
        {
          publicId: "pub-v2",
          content: "version 2",
          reasoning: null,
          branchReason: "retry",
          toolCalls: targetToolCalls,
        },
      ],
    });

    await useChatStreamStore.getState().switchVersion(key, "pub-v1", "next");

    const msg = useChatStreamStore.getState().runtimes[key].messages[0];
    expect(msg.toolCalls).toEqual(targetToolCalls);
    expect(msg.toolCalls).not.toEqual(oldToolCalls);
    expect(msg.toolCalls?.some((c) => c.toolName === "old-search")).toBe(false);
  });

  it("切换到有 feedback 的版本时正确替换", async () => {
    seedAssistant({ feedback: { rating: "up" } });
    mocks.getMessageSiblings.mockResolvedValue({
      current: { publicId: "pub-v1", parentId: "user-1" },
      siblings: [
        {
          publicId: "pub-v1",
          content: "version 1",
          reasoning: null,
          branchReason: null,
          feedback: { rating: "up" },
        },
        {
          publicId: "pub-v2",
          content: "version 2",
          reasoning: null,
          branchReason: "retry",
          feedback: { rating: "down", reason: "incorrect" },
        },
      ],
    });

    await useChatStreamStore.getState().switchVersion(key, "pub-v1", "next");

    const msg = useChatStreamStore.getState().runtimes[key].messages[0];
    expect(msg.publicId).toBe("pub-v2");
    expect(msg.feedback).toEqual({ rating: "down", reason: "incorrect" });
  });

  it("切换到无反馈版本时清空旧 feedback", async () => {
    seedAssistant({ feedback: { rating: "down", reason: "outdated" } });
    mocks.getMessageSiblings.mockResolvedValue({
      current: { publicId: "pub-v1", parentId: "user-1" },
      siblings: [
        {
          publicId: "pub-v1",
          content: "version 1",
          reasoning: null,
          branchReason: null,
          feedback: { rating: "down", reason: "outdated" },
        },
        { publicId: "pub-v2", content: "version 2", reasoning: null, branchReason: "retry" },
      ],
    });

    await useChatStreamStore.getState().switchVersion(key, "pub-v1", "next");

    const msg = useChatStreamStore.getState().runtimes[key].messages[0];
    expect(msg.publicId).toBe("pub-v2");
    expect(msg.feedback).toBeUndefined();
  });

  it("版本选择持久化失败时不切换本地消息", async () => {
    mocks.getMessageSiblings.mockResolvedValue({
      current: { publicId: "pub-v1", parentId: "user-1" },
      siblings: [
        { publicId: "pub-v1", content: "version 1", reasoning: null, branchReason: null },
        { publicId: "pub-v2", content: "version 2", reasoning: null, branchReason: "retry" },
      ],
    });
    mocks.selectMessageVersion.mockRejectedValue(new Error("write failed"));

    await useChatStreamStore.getState().switchVersion(key, "pub-v1", "next");

    expect(useChatStreamStore.getState().runtimes[key].messages[0].publicId).toBe("pub-v1");
  });

  it("setMessageFeedbackLocal 只更新目标消息", () => {
    seedAssistant({ feedback: { rating: "up" } });
    useChatStreamStore.setState((s) => ({
      runtimes: {
        [key]: {
          ...s.runtimes[key],
          messages: [
            ...s.runtimes[key].messages,
            { role: "assistant", publicId: "pub-other", content: "other", feedback: { rating: "down" } },
          ],
        },
      },
    }));

    useChatStreamStore.getState().setMessageFeedbackLocal(key, "pub-v1", {
      rating: "down",
      reason: "unsafe",
    });

    const msgs = useChatStreamStore.getState().runtimes[key].messages;
    expect(msgs[0].feedback).toEqual({ rating: "down", reason: "unsafe" });
    expect(msgs[1].feedback).toEqual({ rating: "down" });
  });
});

describe("chatStreamStore regenerate version selection", () => {
  const key = "conversation-regenerate";

  beforeEach(() => {
    vi.clearAllMocks();
    useChatStreamStore.setState({
      runtimes: {
        [key]: {
          messages: [{
            role: "assistant",
            publicId: "assistant-old",
            content: "Old answer",
            runMetadata: { model: "Old Model", durationMs: 500 },
          }],
          streaming: false,
          abortController: null,
        },
      },
      activeConversationId: key,
      optimisticConversation: null,
    });
    mocks.retryFromMessage.mockResolvedValue({
      newAssistantPublicId: "assistant-placeholder",
      parentPublicId: "user-1",
      messages: [{ role: "user", content: "Question" }],
    });
    mocks.selectMessageVersion.mockResolvedValue(undefined);
    mocks.handleStreamError.mockReturnValue({ content: "[错误] request failed" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data: done\n\n")));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("流成功结束后持久化后端返回的真实版本 ID", async () => {
    mocks.getMessageSiblings.mockResolvedValue({
      current: { publicId: "assistant-real", parentId: "user-1" },
      siblings: [
        { publicId: "assistant-old", content: "Old answer", reasoning: null, branchReason: null },
        { publicId: "assistant-real", content: "New answer", reasoning: null, branchReason: "retry" },
      ],
    });
    mocks.consumeChatSSE.mockImplementationOnce(async (
      _body: ReadableStream<Uint8Array>,
      handlers: SSEHandlers,
    ) => {
      expect(useChatStreamStore.getState().runtimes[key].messages[0].runMetadata)
        .toBeUndefined();
      handlers.onAssistantMessage?.("assistant-real", "2026-07-28T04:00:00.000Z");
      handlers.onFinish?.(finishMetadata);
      return "success" as const;
    });

    await useChatStreamStore.getState().regenerate(key, "assistant-old", "model-a", "model-id-a");

    expect(mocks.selectMessageVersion).toHaveBeenCalledWith("assistant-real");
    expect(mocks.getMessageSiblings).toHaveBeenCalledWith("assistant-real");
    expect(useChatStreamStore.getState().runtimes[key].messages[0]).toMatchObject({
      publicId: "assistant-real",
      createdAt: "2026-07-28T04:00:00.000Z",
      runMetadata: finishMetadata,
      versionInfo: { current: 2, total: 2 },
    });
  });

  it("版本选择持久化失败不把已完成生成标记为失败", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.consumeChatSSE.mockImplementationOnce(async (
      _body: ReadableStream<Uint8Array>,
      handlers: { onAssistantMessage?: (publicId: string) => void },
    ) => {
      handlers.onAssistantMessage?.("assistant-real");
      return "success" as const;
    });
    mocks.selectMessageVersion.mockRejectedValue(new Error("write failed"));

    await useChatStreamStore.getState().regenerate(key, "assistant-old", "model-a", "model-id-a");

    expect(mocks.handleStreamError).not.toHaveBeenCalled();
    expect(useChatStreamStore.getState().runtimes[key].messages[0]).toMatchObject({
      publicId: "assistant-real",
      content: "",
    });
    expect(consoleError).toHaveBeenCalledWith("persist regenerated version failed:", expect.any(Error));
    consoleError.mockRestore();
  });
});
