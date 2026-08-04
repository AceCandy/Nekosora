import { describe, expect, it, vi } from "vitest";
import { consumeChatSSE } from "./sse";

const encoder = new TextEncoder();

describe("consumeChatSSE", () => {
  it("解析消息身份帧的稳定标识和创建时间", async () => {
    const onUserMessage = vi.fn();
    const onAssistantMessage = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"type":"user_message","publicId":"user-1","createdAt":"2026-07-28T01:02:03.000Z"}\n\n' +
          'data: {"type":"assistant_message","publicId":"assistant-1","createdAt":"2026-07-28T01:02:04.000Z"}\n\n' +
          'data: {"type":"terminal","status":"interrupted"}\n\n' +
          "data: [DONE]\n\n",
        ));
        controller.close();
      },
    });

    await expect(consumeChatSSE(body, {
      onDelta: vi.fn(),
      onUserMessage,
      onAssistantMessage,
    })).resolves.toBe("interrupted");

    expect(onUserMessage).toHaveBeenCalledWith(
      "user-1",
      "2026-07-28T01:02:03.000Z",
    );
    expect(onAssistantMessage).toHaveBeenCalledWith(
      "assistant-1",
      "2026-07-28T01:02:04.000Z",
    );
  });

  it("解析 finish 的运行元数据,并保留真实零值", async () => {
    const onFinish = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"type":"finish","metadata":{"model":"Model A","tokenUsage":{"completionTokens":0,"reasoningTokens":0},"durationMs":0,"completedAt":"2026-07-27T08:09:10.000Z"}}\n\n' +
          'data: {"type":"terminal","status":"success"}\n\n' +
          "data: [DONE]\n\n",
        ));
        controller.close();
      },
    });

    await expect(consumeChatSSE(body, { onDelta: vi.fn(), onFinish }))
      .resolves.toBe("success");

    expect(onFinish).toHaveBeenCalledWith({
      model: "Model A",
      tokenUsage: { completionTokens: 0, reasoningTokens: 0 },
      durationMs: 0,
      completedAt: "2026-07-27T08:09:10.000Z",
    });
  });

  it("透传工具调用 ID 与搜索生命周期", async () => {
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    const onSearchStarted = vi.fn();
    const onSearchCompleted = vi.fn();
    const onSearchFailed = vi.fn();
    const body = streamFrom(
      'data: {"type":"tool_call","toolCallId":"tc-1","toolName":"web_search","args":{"query":"latest"}}\n\n' +
      'data: {"type":"search_started","toolCallId":"tc-1","query":"latest"}\n\n' +
      'data: {"type":"search_completed","toolCallId":"tc-1","backend":{"type":"provider","id":"tavily","name":"Tavily"},"citations":[{"title":"Source","url":"https://example.com","publishedAt":"2026-08-03T00:00:00.000Z"}]}\n\n' +
      'data: {"type":"tool_result","toolCallId":"tc-1","toolName":"web_search","isError":false}\n\n' +
      'data: {"type":"search_failed","toolCallId":"tc-2","reason":"unavailable"}\n\n' +
      'data: {"type":"terminal","status":"interrupted"}\n\n' +
      "data: [DONE]\n\n",
    );

    await consumeChatSSE(body, {
      onDelta: vi.fn(),
      onToolCall,
      onToolResult,
      onSearchStarted,
      onSearchCompleted,
      onSearchFailed,
    });

    expect(onToolCall).toHaveBeenCalledWith("web_search", { query: "latest" }, "tc-1");
    expect(onSearchStarted).toHaveBeenCalledWith("tc-1", "latest");
    expect(onSearchCompleted).toHaveBeenCalledWith(
      "tc-1",
      [{
        title: "Source",
        url: "https://example.com",
        publishedAt: "2026-08-03T00:00:00.000Z",
      }],
      { type: "provider", id: "tavily", name: "Tavily" },
    );
    expect(onToolResult).toHaveBeenCalledWith("web_search", false, "tc-1");
    expect(onSearchFailed).toHaveBeenCalledWith("tc-2", "unavailable");
  });

  it("收到可靠 DONE 后立即结束，不等待网络 EOF", async () => {
    const onDelta = vi.fn();
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        controller.enqueue(encoder.encode(
          'data: {"type":"delta","text":"完成"}\n\n' +
          'data: {"type":"terminal","status":"interrupted"}\n\n' +
          "data: [DONE]\n\n",
        ));
        // 故意不 close：验证消费器由 DONE 终止，而不是等待 reader.done。
      },
    });

    await expect(consumeChatSSE(body, { onDelta })).resolves.toBe("interrupted");

    expect(onDelta).toHaveBeenCalledWith("完成");
    expect(controllerRef).not.toBeNull();
    controllerRef?.close();
  });

  it("失败 terminal 是正常协议终态而不是成功", async () => {
    const onError = vi.fn();
    const body = streamFrom(
      'data: {"type":"error","error":"生成失败"}\n\n' +
      'data: {"type":"terminal","status":"failed"}\n\n' +
      "data: [DONE]\n\n",
    );

    await expect(consumeChatSSE(body, { onDelta: vi.fn(), onError }))
      .resolves.toBe("failed");
    expect(onError).toHaveBeenCalledWith("生成失败");
  });

  it("拒绝缺少 terminal 的 DONE", async () => {
    const body = streamFrom("data: [DONE]\n\n");

    await expect(consumeChatSSE(body, { onDelta: vi.fn() }))
      .rejects.toThrow("终态");
  });

  it("拒绝没有 finish 的 success terminal", async () => {
    const body = streamFrom(
      'data: {"type":"terminal","status":"success"}\n\n' +
      "data: [DONE]\n\n",
    );

    await expect(consumeChatSSE(body, { onDelta: vi.fn() }))
      .rejects.toThrow("finish");
  });

  it("拒绝 finish 与非 success terminal 的矛盾终态", async () => {
    const body = streamFrom(
      'data: {"type":"finish","metadata":{}}\n\n' +
      'data: {"type":"terminal","status":"failed"}\n\n' +
      "data: [DONE]\n\n",
    );

    await expect(consumeChatSSE(body, { onDelta: vi.fn() }))
      .rejects.toThrow("terminal");
  });

  it("拒绝 terminal 后缺少 DONE 的 EOF", async () => {
    const body = streamFrom('data: {"type":"terminal","status":"failed"}\n\n');

    await expect(consumeChatSSE(body, { onDelta: vi.fn() }))
      .rejects.toThrow("DONE");
  });

  it("拒绝重复 terminal 与 terminal 后业务帧", async () => {
    const duplicate = streamFrom(
      'data: {"type":"terminal","status":"failed"}\n\n' +
      'data: {"type":"terminal","status":"failed"}\n\n' +
      "data: [DONE]\n\n",
    );
    const eventAfterTerminal = streamFrom(
      'data: {"type":"terminal","status":"failed"}\n\n' +
      'data: {"type":"delta","text":"late"}\n\n' +
      "data: [DONE]\n\n",
    );

    await expect(consumeChatSSE(duplicate, { onDelta: vi.fn() }))
      .rejects.toThrow("terminal");
    await expect(consumeChatSSE(eventAfterTerminal, { onDelta: vi.fn() }))
      .rejects.toThrow("terminal");
  });

  it("拒绝非法 terminal status", async () => {
    const body = streamFrom(
      'data: {"type":"terminal","status":"unknown"}\n\n' +
      "data: [DONE]\n\n",
    );

    await expect(consumeChatSSE(body, { onDelta: vi.fn() }))
      .rejects.toThrow("terminal");
  });

  it("处理跨 chunk 且没有尾换行的 DONE", async () => {
    const chunks = [
      'data: {"type":"finish","metadata":{}}\n\nda',
      'ta: {"type":"terminal","status":"success"}\n\ndata: [DO',
      "NE]",
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });

    await expect(consumeChatSSE(body, { onDelta: vi.fn() }))
      .resolves.toBe("success");
  });
});

function streamFrom(content: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(content));
      controller.close();
    },
  });
}
