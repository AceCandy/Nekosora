import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeChatSSE: vi.fn(),
  handleStreamError: vi.fn(),
  createConversation: vi.fn(),
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
  getMessageSiblings: vi.fn(),
  softDeleteMessage: vi.fn(),
  continueMessage: vi.fn(),
}));

import { useChatStreamStore } from "@/features/chat/store/chatStreamStore";

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
