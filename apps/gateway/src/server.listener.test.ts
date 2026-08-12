import { describe, expect, it, vi } from "vitest";
import { request as httpRequest } from "node:http";
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

  it.each([
    ["v1ChatCompletions", "/v1/chat/completions"],
    ["v1Responses", "/v1/responses"],
    ["v1Messages", "/v1/messages"],
    ["v1GeminiGenerateContent", "/v1beta/models/gemini-2.5-pro:generateContent"],
    ["v1GeminiStreamGenerateContent", "/v1beta/models/gemini-2.5-pro:streamGenerateContent"],
  ] as const)("%s 客户端断开后中止 handler 请求并取消上游流", async (handlerName, path) => {
    let handlerSignal: AbortSignal | undefined;
    let streamCancelled = false;
    const app = buildServer({
      handlers: {
        [handlerName]: async (request: Request) => {
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

    try {
      const firstEvent = await new Promise<string>((resolve, reject) => {
        const request = httpRequest(`${address}${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": 2,
          },
        }, (response) => {
          let received = "";
          response.once("error", reject);
          response.on("data", (chunk: Buffer) => {
            received += chunk.toString();
            const boundary = received.indexOf("\n\n");
            if (boundary === -1) return;
            response.destroy();
            resolve(received.slice(0, boundary + 2));
          });
        });
        request.once("error", reject);
        request.end("{}");
      });
      expect(firstEvent).toBe("data: first\n\n");

      await vi.waitFor(() => expect(handlerSignal?.aborted).toBe(true));
      await vi.waitFor(() => expect(streamCancelled).toBe(true));
    } finally {
      await app.close();
    }
  });
});
