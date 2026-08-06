import { describe, expect, it, vi } from "vitest";
import { buildServer } from "./server";

describe("Gateway listener", () => {
  it("不启动 Web 也能处理 API-key 数据面请求", async () => {
    const app = buildServer({
      handlers: {
        v1Models: async (request) => {
          expect(request.headers.get("authorization")).toBe("Bearer sk-listener");
          return Response.json({ object: "list", data: [{ id: "model-1" }] });
        },
        v1ChatCompletions: async (request) => {
          expect(await request.json()).toEqual({ model: "model-1", messages: [] });
          return Response.json({ id: "chatcmpl-listener" });
        },
      },
      closeResources: async () => {},
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    try {
      const models = await fetch(`${address}/v1/models`, {
        headers: { authorization: "Bearer sk-listener" },
      });
      expect(models.status).toBe(200);
      expect(await models.json()).toEqual({
        object: "list",
        data: [{ id: "model-1" }],
      });

      const chat = await fetch(`${address}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: "Bearer sk-listener",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "model-1", messages: [] }),
      });
      expect(chat.status).toBe(200);
      expect(await chat.json()).toEqual({ id: "chatcmpl-listener" });
    } finally {
      await app.close();
    }
  });

  it("客户端断开 SSE 后中止 handler 请求并取消上游流", async () => {
    let handlerSignal: AbortSignal | undefined;
    let streamCancelled = false;
    const app = buildServer({
      handlers: {
        apiChat: async (request) => {
          handlerSignal = request.signal;
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: first\n\n"));
              },
              cancel() {
                streamCancelled = true;
              },
            }),
            { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
          );
        },
      },
      closeResources: async () => {},
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const abortController = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const response = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: abortController.signal,
      });
      reader = response.body?.getReader();
      expect(reader).toBeDefined();
      const first = await reader!.read();
      expect(new TextDecoder().decode(first.value)).toBe("data: first\n\n");

      abortController.abort();
      await vi.waitFor(() => expect(handlerSignal?.aborted).toBe(true));
      await vi.waitFor(() => expect(streamCancelled).toBe(true));
    } finally {
      abortController.abort();
      await reader?.cancel().catch(() => undefined);
      await app.close();
    }
  });
});
