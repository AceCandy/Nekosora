import { describe, expect, it, vi } from "vitest";
import { consumeChatSSE } from "./sse";

const encoder = new TextEncoder();

describe("consumeChatSSE", () => {
  it("解析 finish 的运行元数据,并保留真实零值", async () => {
    const onFinish = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"type":"finish","metadata":{"model":"Model A","tokenUsage":{"completionTokens":0,"reasoningTokens":0},"durationMs":0,"completedAt":"2026-07-27T08:09:10.000Z"}}\n\n' +
          "data: [DONE]\n\n",
        ));
        controller.close();
      },
    });

    await consumeChatSSE(body, { onDelta: vi.fn(), onFinish });

    expect(onFinish).toHaveBeenCalledWith({
      model: "Model A",
      tokenUsage: { completionTokens: 0, reasoningTokens: 0 },
      durationMs: 0,
      completedAt: "2026-07-27T08:09:10.000Z",
    });
  });

  it("收到可靠 DONE 后立即结束，不等待网络 EOF", async () => {
    const onDelta = vi.fn();
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        controller.enqueue(encoder.encode(
          'data: {"type":"delta","text":"完成"}\n\n' +
          "data: [DONE]\n\n",
        ));
        // 故意不 close：验证消费器由 DONE 终止，而不是等待 reader.done。
      },
    });

    await consumeChatSSE(body, { onDelta });

    expect(onDelta).toHaveBeenCalledWith("完成");
    expect(controllerRef).not.toBeNull();
    controllerRef?.close();
  });
});
