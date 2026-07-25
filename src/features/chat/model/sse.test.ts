import { describe, expect, it, vi } from "vitest";
import { consumeChatSSE } from "./sse";

const encoder = new TextEncoder();

describe("consumeChatSSE", () => {
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
