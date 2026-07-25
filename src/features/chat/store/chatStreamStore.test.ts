import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeChatSSE: vi.fn(),
  handleStreamError: vi.fn(),
  createConversation: vi.fn(),
  getMessageSiblings: vi.fn(),
}));

vi.mock("@/features/chat/model/sse", () => ({
  consumeChatSSE: mocks.consumeChatSSE,
  handleStreamError: mocks.handleStreamError,
}));
vi.mock("@/features/chat/actions/conversations", () => ({
  createConversation: mocks.createConversation,
}));
vi.mock("@/features/chat/actions/branch", () => ({
  retryFromMessage: vi.fn(),
  editMessage: vi.fn(),
  getMessageSiblings: mocks.getMessageSiblings,
  softDeleteMessage: vi.fn(),
  continueMessage: vi.fn(),
}));

import { useChatStreamStore } from "@/features/chat/store/chatStreamStore";
import type { ChatMessage, ToolCallRecord } from "@/features/chat/model/types";

const sendOptions = { model: "model-a", modelId: "model-id-a" };

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
