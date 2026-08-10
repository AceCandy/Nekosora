import { beforeEach, describe, expect, it, vi } from "vitest";

const readinessMocks = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  getDb: vi.fn(),
  getStorage: vi.fn(),
  resolveStorageKind: vi.fn(),
  queueAvailable: vi.fn(),
  closeDb: vi.fn(),
  closeQueue: vi.fn(),
}));

vi.mock("@nekusora/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@nekusora/db")>(),
  getDb: readinessMocks.getDb,
  closeDb: readinessMocks.closeDb,
}));
vi.mock("@nekusora/core/storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("@nekusora/core/storage")>(),
  getStorage: readinessMocks.getStorage,
  resolveStorageKind: readinessMocks.resolveStorageKind,
}));
vi.mock("@nekusora/queue", async (importOriginal) => ({
  ...await importOriginal<typeof import("@nekusora/queue")>(),
  queueAvailable: readinessMocks.queueAvailable,
  closeQueue: readinessMocks.closeQueue,
}));

import { GATEWAY_ROUTES, type GatewayHandlerName } from "@nekusora/contracts/routes";
import {
  buildServer,
  closeGatewayResources,
  type BuildServerOptions,
} from "./server";

function withHandler(
  name: GatewayHandlerName,
  handler: NonNullable<BuildServerOptions["handlers"]>[GatewayHandlerName],
) {
  return buildServer({ handlers: { [name]: handler }, closeResources: async () => {} });
}

function multipartFile(size: number) {
  const boundary = "nekusora-limit-boundary";
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.bin"\r\n` +
        "Content-Type: application/octet-stream\r\n\r\n",
      ),
      Buffer.alloc(size),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

describe("Gateway HTTP adapter", () => {
  beforeEach(() => {
    readinessMocks.dbExecute.mockReset().mockResolvedValue(undefined);
    readinessMocks.getDb.mockReset().mockResolvedValue({ execute: readinessMocks.dbExecute });
    readinessMocks.getStorage.mockReset().mockResolvedValue({ kind: "local" });
    readinessMocks.resolveStorageKind.mockReset().mockReturnValue(null);
    readinessMocks.queueAvailable.mockReset().mockResolvedValue(true);
    readinessMocks.closeDb.mockReset().mockResolvedValue(undefined);
    readinessMocks.closeQueue.mockReset().mockResolvedValue(undefined);
  });

  it("注册完整的数据面路由矩阵", async () => {
    const app = buildServer({ closeResources: async () => {} });
    for (const route of GATEWAY_ROUTES) {
      expect(app.hasRoute({ method: route.method, url: route.path })).toBe(true);
    }
    await app.close();
  });

  it.each([
    [
      "v1GeminiGenerateContent",
      "/v1beta/models/publishers/google/models/gemini-2.5-pro:generateContent",
    ],
    [
      "v1GeminiStreamGenerateContent",
      "/v1beta/models/publishers/google/models/gemini-2.5-pro:streamGenerateContent",
    ],
  ] as const)("%s 捕获完整 Gemini model 路径", async (handlerName, url) => {
    const handler = vi.fn(async (request: Request, params: Readonly<Record<string, string>>) => {
      expect(params.model).toBe("publishers/google/models/gemini-2.5-pro");
      expect(await request.json()).toEqual({ contents: [{ parts: [{ text: "hello" }] }] });
      return Response.json({ ok: true });
    });
    const app = withHandler(handlerName, handler);

    const response = await app.inject({
      method: "POST",
      url,
      headers: { "content-type": "application/json" },
      payload: { contents: [{ parts: [{ text: "hello" }] }] },
    });

    expect(response.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    await app.close();
  });

  it("Gemini 未知操作不进入协议 handler", async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const app = withHandler("v1GeminiGenerateContent", handler);

    const response = await app.inject({
      method: "POST",
      url: "/v1beta/models/gemini-2.5-pro:unknownOperation",
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    expect(handler).not.toHaveBeenCalled();
    await app.close();
  });

  it("保留请求头、原始 JSON 与响应状态", async () => {
    const app = withHandler("v1ChatCompletions", async (request) => {
      expect(request.headers.get("authorization")).toBe("Bearer sk-test");
      expect(await request.text()).toBe('{"model":');
      return Response.json({ error: "bad json" }, { status: 400 });
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
      payload: '{"model":',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "bad json" });
    await app.close();
  });

  it("把 multipart 请求转换为标准 FormData", async () => {
    const app = withHandler("v1AudioTranscriptions", async (request) => {
      const form = await request.formData();
      const file = form.get("file");
      expect(form.get("model")).toBe("whisper-1");
      expect(file).toBeInstanceOf(File);
      expect(await (file as File).text()).toBe("audio");
      return Response.json({ text: "ok" });
    });
    const boundary = "nekusora-boundary";
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.mp3"\r\n` +
      `Content-Type: audio/mpeg\r\n\r\naudio\r\n--${boundary}--\r\n`,
    );
    const response = await app.inject({
      method: "POST",
      url: "/v1/audio/transcriptions",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: "ok" });
    await app.close();
  });

  it.each([
    ["apiUpload", "/api/upload", 10 * 1024 * 1024, "zh-CN", "请求体过大"],
    [
      "v1AudioTranscriptions",
      "/v1/audio/transcriptions",
      25 * 1024 * 1024,
      "en",
      "Request payload is too large",
    ],
  ] as const)("%s 在 Fastify 层按路由限制文件大小", async (
    handlerName,
    url,
    maxFileBytes,
    language,
    message,
  ) => {
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const app = withHandler(handlerName, handler);
    const multipart = multipartFile(maxFileBytes + 1);

    const response = await app.inject({
      method: "POST",
      url,
      headers: {
        "accept-language": language,
        "content-type": multipart.contentType,
      },
      payload: multipart.payload,
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: {
        code: "request.payload_too_large",
        message,
        type: "invalid_request_error",
        details: { maxFileBytes },
      },
    });
    expect(handler).not.toHaveBeenCalled();
    await app.close();
  });

  it("500 响应不暴露 handler 的原始错误", async () => {
    const app = withHandler("v1Models", async () => {
      throw new Error("postgres://user:secret@db/internal");
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { "accept-language": "en" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: "server.internal",
        message: "Internal server error",
        type: "server_error",
      },
    });
    expect(response.body).not.toContain("postgres://");
    await app.close();
  });

  it("透传 SSE 字节与关闭资源", async () => {
    const closeResources = vi.fn(async () => {});
    const app = buildServer({
      handlers: {
        v1ChatCompletions: async () => new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: {\"ok\":true}\n\n"));
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
        ),
      },
      closeResources,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    expect(response.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(response.body).toBe("data: {\"ok\":true}\n\ndata: [DONE]\n\n");
    await app.close();
    expect(closeResources).toHaveBeenCalledOnce();
  });

  it("等待 reaper 停止后再关闭 queue 与数据库", async () => {
    const events: string[] = [];
    let release!: () => void;
    const stopped = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reaper = {
      stop: vi.fn(() => {
        events.push("reaper");
        return stopped;
      }),
    };
    readinessMocks.closeQueue.mockImplementation(async () => {
      events.push("queue");
    });
    readinessMocks.closeDb.mockImplementation(async () => {
      events.push("db");
    });

    const closing = closeGatewayResources(reaper);
    await Promise.resolve();

    expect(events).toEqual(["reaper"]);
    expect(readinessMocks.closeQueue).not.toHaveBeenCalled();
    expect(readinessMocks.closeDb).not.toHaveBeenCalled();

    release();
    await closing;

    expect(events).toEqual(["reaper", "queue", "db"]);
  });
});

describe("Gateway readiness", () => {
  beforeEach(() => {
    readinessMocks.dbExecute.mockReset().mockResolvedValue(undefined);
    readinessMocks.getDb.mockReset().mockResolvedValue({ execute: readinessMocks.dbExecute });
    readinessMocks.getStorage.mockReset().mockResolvedValue({ kind: "local" });
    readinessMocks.resolveStorageKind.mockReset().mockReturnValue(null);
    readinessMocks.queueAvailable.mockReset().mockResolvedValue(true);
  });

  it("DB 与 queue 正常时返回 ready", async () => {
    const app = buildServer({ closeResources: async () => {} });
    const response = await app.inject({ method: "GET", url: "/healthz/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      checks: { db: "ok", storage: "local", queue: { available: true } },
    });
    await app.close();
  });

  it("readiness 快速完成后清理超时定时器", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const app = buildServer({ closeResources: async () => {} });

    try {
      const response = await app.inject({ method: "GET", url: "/healthz/ready" });

      expect(response.statusCode).toBe(200);
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
      await app.close();
    }
  });

  it("queue 显式不可用时返回 503", async () => {
    readinessMocks.queueAvailable.mockResolvedValue(false);
    const app = buildServer({ closeResources: async () => {} });
    const response = await app.inject({ method: "GET", url: "/healthz/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "unready",
      checks: { db: "ok", queue: { available: false } },
    });
    await app.close();
  });

  it("queue 初始化异常时返回 503 并保留诊断", async () => {
    readinessMocks.queueAvailable.mockRejectedValue(new Error("queue unavailable"));
    const app = buildServer({ closeResources: async () => {} });
    const response = await app.inject({ method: "GET", url: "/healthz/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "unready",
      checks: { db: "ok", queue: "error" },
    });
    await app.close();
  });

  it("queue 检查超时时返回 503", async () => {
    vi.useFakeTimers();
    readinessMocks.queueAvailable.mockReturnValue(new Promise(() => {}));
    const app = buildServer({ closeResources: async () => {} });

    try {
      const responsePromise = app.inject({ method: "GET", url: "/healthz/ready" });
      await vi.advanceTimersByTimeAsync(2_000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        status: "unready",
        checks: { db: "ok", queue: "timeout" },
      });
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  });

  it("DB 异常时即使 queue 正常也返回 503", async () => {
    readinessMocks.dbExecute.mockRejectedValue(new Error("db unavailable"));
    const app = buildServer({ closeResources: async () => {} });
    const response = await app.inject({ method: "GET", url: "/healthz/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "unready",
      checks: { db: "error", queue: { available: true } },
    });
    await app.close();
  });

  it("storage 初始化异常时返回 503", async () => {
    readinessMocks.getStorage.mockRejectedValue(new Error("storage unavailable"));
    const app = buildServer({ closeResources: async () => {} });
    const response = await app.inject({ method: "GET", url: "/healthz/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "unready",
      checks: { db: "ok", storage: "error", queue: { available: true } },
    });
    await app.close();
  });

  it("配置的 storage 降级为 local 时返回 503", async () => {
    readinessMocks.resolveStorageKind.mockReturnValue("s3");
    const app = buildServer({ closeResources: async () => {} });
    const response = await app.inject({ method: "GET", url: "/healthz/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "unready",
      checks: { db: "ok", storage: "error", queue: { available: true } },
    });
    await app.close();
  });
});
