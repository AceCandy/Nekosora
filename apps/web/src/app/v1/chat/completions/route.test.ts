import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  extractBearer: vi.fn(),
  verifyKey: vi.fn(),
  streamChat: vi.fn(),
  getGatewayUA: vi.fn(),
  loadWebSearchConfig: vi.fn(),
}));

vi.mock("@/lib/keys", () => ({
  extractBearer: mocks.extractBearer,
  verifyKey: mocks.verifyKey,
}));
vi.mock("@/lib/stream", () => ({ streamChat: mocks.streamChat }));
vi.mock("@/lib/system-settings/ua", () => ({ getGatewayUA: mocks.getGatewayUA }));
vi.mock("@/lib/web-search/registry", () => ({ loadConfig: mocks.loadWebSearchConfig }));

import { POST } from "./route";

function request(extraBody: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: "Bearer sk-test",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
      ...extraBody,
    }),
  });
}

describe("POST /v1/chat/completions 流式取消", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.streamChat.mockReset();
    mocks.getGatewayUA.mockReset();
    mocks.extractBearer.mockReturnValue("sk-test");
    mocks.verifyKey.mockResolvedValue({
      ctx: { userId: "user-1", apiKeyId: "key-1", keyKind: "master", source: "gateway" },
    });
    mocks.getGatewayUA.mockResolvedValue("Nekusora-Test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("消费者取消响应时中止传给 streamChat 的信号", async () => {
    let receivedSignal: AbortSignal | undefined;
    let releaseUpstream: (() => void) | undefined;
    mocks.streamChat.mockImplementation((opts: { abortSignal?: AbortSignal }) => {
      receivedSignal = opts.abortSignal;
      return (async function* () {
        yield { type: "text-delta", text: "hello" };
        await new Promise<void>((resolve) => {
          releaseUpstream = resolve;
        });
      })();
    });

    const response = await POST(request());
    await vi.waitFor(() => expect(releaseUpstream).toBeTypeOf("function"));

    expect(response.body).not.toBeNull();
    const enqueueSpy = vi.spyOn(ReadableStreamDefaultController.prototype, "enqueue");
    const closeSpy = vi.spyOn(ReadableStreamDefaultController.prototype, "close");
    const cancelPromise = response.body!.cancel();
    try {
      await Promise.resolve();
      expect(receivedSignal?.aborted).toBe(true);
    } finally {
      releaseUpstream?.();
      await expect(cancelPromise).resolves.toBeUndefined();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(enqueueSpy).not.toHaveBeenCalled();
      expect(closeSpy).not.toHaveBeenCalled();
    }
  });

  it("等待网关 UA 期间取消后不再启动 streamChat", async () => {
    let resolveUserAgent: ((value: string) => void) | undefined;
    mocks.getGatewayUA.mockReturnValue(new Promise<string>((resolve) => {
      resolveUserAgent = resolve;
    }));
    mocks.streamChat.mockReturnValue((async function* () {})());

    const response = await POST(request());
    expect(response.body).not.toBeNull();
    const cancelPromise = response.body!.cancel();
    resolveUserAgent?.("Nekusora-Test");

    await expect(cancelPromise).resolves.toBeUndefined();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(mocks.streamChat).not.toHaveBeenCalled();
  });

  it("正常完成时保留内容帧和 DONE 终止帧", async () => {
    mocks.streamChat.mockReturnValue((async function* () {
      yield { type: "text-delta", text: "hello" };
      yield {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      };
    })());

    const response = await POST(request());
    const body = await response.text();

    expect(body).toContain('"content":"hello"');
    expect(body).toContain('"finish_reason":"stop"');
    expect(body).toContain("data: [DONE]\n\n");
  });

  it("接受 OpenAI 客户端发送的 stream_options.include_usage", async () => {
    mocks.streamChat.mockReturnValue((async function* () {
      yield { type: "finish", finishReason: "stop", usage: {} };
    })());

    const response = await POST(request({
      stream_options: { include_usage: true },
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(mocks.streamChat).toHaveBeenCalledOnce();
    expect(body).toContain("data: [DONE]\n\n");
  });

  it("拒绝未知 stream_options 子字段且不触网上游", async () => {
    const response = await POST(request({
      stream_options: { include_cost: true },
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        code: "request.unsupported_parameter",
        message: "Unsupported parameter: 'stream_options.include_cost'.",
        param: "stream_options.include_cost",
      },
    });
    expect(mocks.streamChat).not.toHaveBeenCalled();
  });

  it("拒绝 WebChat 专有联网参数且不触网上游", async () => {
    mocks.streamChat.mockReturnValue((async function* () {
      yield { type: "finish", finishReason: "stop", usage: {} };
    })());

    const response = await POST(request({ webSearch: true }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        code: "request.unsupported_parameter",
        message: "Unsupported parameter: 'webSearch'.",
        param: "webSearch",
      },
    });
    expect(mocks.loadWebSearchConfig).not.toHaveBeenCalled();
    expect(mocks.streamChat).not.toHaveBeenCalled();
  });

  it("普通异常时保留 SSE server_error 帧", async () => {
    mocks.streamChat.mockReturnValue((async function* () {
      throw new Error("upstream down Authorization: Bearer ROUTE_SECRET");
    })());

    const response = await POST(request());
    const body = await response.text();

    expect(body).toContain('"message":"upstream down Authorization: Bearer [REDACTED]"');
    expect(body).not.toContain("ROUTE_SECRET");
    expect(body).toContain('"type":"server_error"');
    expect(body).not.toContain("data: [DONE]");
  });
});
