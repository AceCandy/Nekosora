import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeChatSSE: vi.fn(),
  handleStreamError: vi.fn(),
  createConversation: vi.fn(),
  getConversationTitleStateAction: vi.fn(),
  retryFromMessage: vi.fn(),
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
  editMessage: vi.fn(),
  getMessageSiblings: mocks.getMessageSiblings,
  selectMessageVersion: mocks.selectMessageVersion,
  softDeleteMessage: vi.fn(),
  continueMessage: vi.fn(),
}));

import { NEW_CONVERSATION_KEY, useChatStreamStore } from "@/features/chat/store/chatStreamStore";
import type { ChatMessage, ToolCallRecord } from "@/features/chat/model/types";

const sendOptions = { model: "model-a", modelId: "model-id-a" };

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
    mocks.consumeChatSSE.mockResolvedValue(undefined);
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
    mocks.consumeChatSSE.mockResolvedValue(undefined);
    mocks.handleStreamError.mockReturnValue({ content: "[错误] request failed" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("服务器接受请求后消费本轮 fileIds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("data: done\n\n"));
    const uploadAttachments = vi.fn().mockResolvedValue(["file-1"]);
    const onAttachmentsConsumed = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.consumeChatSSE.mockImplementationOnce(async () => {
      expect(onAttachmentsConsumed).toHaveBeenCalledWith(["file-1"]);
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
      uploadAttachments: vi.fn().mockResolvedValue(["file-1"]),
      onAttachmentsConsumed,
    });

    expect(onAttachmentsConsumed).not.toHaveBeenCalled();
  });

  it("响应已接受后 SSE 失败仍视为附件已消费", async () => {
    const onAttachmentsConsumed = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data: start\n\n")));
    mocks.consumeChatSSE.mockRejectedValue(new Error("stream interrupted"));

    await useChatStreamStore.getState().send("conversation-1", "hello", sendOptions, {
      uploadAttachments: vi.fn().mockResolvedValue(["file-1"]),
      onAttachmentsConsumed,
    });

    expect(onAttachmentsConsumed).toHaveBeenCalledWith(["file-1"]);
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
              trace: { totalTokenEstimate: 1 },
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
          reasoning: "think-v2",
          branchReason: "retry",
          toolCalls: targetToolCalls,
        },
      ],
    });

    await useChatStreamStore.getState().switchVersion(key, "pub-v1", "next");

    const msg = useChatStreamStore.getState().runtimes[key].messages[0];
    expect(msg.publicId).toBe("pub-v2");
    expect(msg.content).toBe("version 2");
    expect(msg.reasoning).toBe("think-v2");
    expect(msg.toolCalls).toEqual(targetToolCalls);
    expect(msg.trace).toBeUndefined();
    expect(msg.searchResults).toBeUndefined();
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
          messages: [{ role: "assistant", publicId: "assistant-old", content: "Old answer" }],
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
    mocks.consumeChatSSE.mockImplementationOnce(async (
      _body: ReadableStream<Uint8Array>,
      handlers: { onAssistantMessage?: (publicId: string) => void },
    ) => {
      handlers.onAssistantMessage?.("assistant-real");
    });

    await useChatStreamStore.getState().regenerate(key, "assistant-old", "model-a", "model-id-a");

    expect(mocks.selectMessageVersion).toHaveBeenCalledWith("assistant-real");
    expect(useChatStreamStore.getState().runtimes[key].messages[0].publicId).toBe("assistant-real");
  });

  it("版本选择持久化失败不把已完成生成标记为失败", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.consumeChatSSE.mockImplementationOnce(async (
      _body: ReadableStream<Uint8Array>,
      handlers: { onAssistantMessage?: (publicId: string) => void },
    ) => {
      handlers.onAssistantMessage?.("assistant-real");
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
