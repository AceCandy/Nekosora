import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dnsLookup: vi.fn(),
  httpRequest: vi.fn(),
  httpsRequest: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: mocks.dnsLookup }));
vi.mock("node:http", () => ({ request: mocks.httpRequest }));
vi.mock("node:https", () => ({ request: mocks.httpsRequest }));

import { requestPublicResponse } from "./public-http";

interface MockResponseOptions {
  status?: number;
  headers?: Record<string, string>;
  chunks?: Buffer[];
}

function queueResponse(options: MockResponseOptions) {
  mocks.httpsRequest.mockImplementationOnce((requestOptions, callback) => {
    const request = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (error: Error) => void;
    };
    request.destroy = (error) => request.emit("error", error);
    request.end = () => {
      const response = new PassThrough() as PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      };
      response.statusCode = options.status ?? 200;
      response.headers = options.headers ?? {};
      queueMicrotask(() => {
        callback(response);
        if (response.destroyed) return;
        for (const chunk of options.chunks ?? []) response.write(chunk);
        response.end();
      });
    };
    const signal = requestOptions.signal as AbortSignal | undefined;
    signal?.addEventListener("abort", () => request.destroy(new Error("aborted")), { once: true });
    return request;
  });
}

describe("受限公网响应读取", () => {
  beforeEach(() => {
    mocks.dnsLookup.mockReset();
    mocks.httpRequest.mockReset();
    mocks.httpsRequest.mockReset();
    mocks.dnsLookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  });

  it("重定向到私网时在下一跳连接前拒绝", async () => {
    queueResponse({ status: 302, headers: { location: "http://127.0.0.1/private" } });

    await expect(requestPublicResponse("https://example.com"))
      .rejects.toMatchObject({ code: "blocked_url" });
    expect(mocks.httpsRequest).toHaveBeenCalledTimes(1);
    expect(mocks.httpRequest).not.toHaveBeenCalled();
  });

  it("在读取正文前拒绝超限 Content-Length", async () => {
    queueResponse({ headers: { "content-length": "10" } });

    await expect(requestPublicResponse("https://example.com", { maxResponseBytes: 4 }))
      .rejects.toMatchObject({ code: "response_too_large" });
  });

  it("流式正文累计超过上限时停止读取", async () => {
    queueResponse({ chunks: [Buffer.from("12345")] });

    await expect(requestPublicResponse("https://example.com", { maxResponseBytes: 4 }))
      .rejects.toMatchObject({ code: "response_too_large" });
  });

  it("HTML 元数据模式只保留上限内的响应前缀", async () => {
    queueResponse({
      headers: { "content-length": "10" },
      chunks: [Buffer.from("12345")],
    });

    await expect(requestPublicResponse("https://example.com", {
      maxResponseBytes: 4,
      truncateBody: true,
    })).resolves.toMatchObject({ body: Buffer.from("1234") });
  });

  it("DNS 解析挂起时响应中止且不发起请求", async () => {
    const controller = new AbortController();
    mocks.dnsLookup.mockReturnValue(new Promise(() => {}));

    const pending = requestPublicResponse("https://example.com", { signal: controller.signal });
    controller.abort(new DOMException("Aborted", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.httpsRequest).not.toHaveBeenCalled();
    expect(mocks.httpRequest).not.toHaveBeenCalled();
  });

  it("系统 DNS 返回 Fake-IP 时用固定 DoH 解析真实公网地址", async () => {
    mocks.dnsLookup.mockResolvedValue([{ address: "198.18.2.208", family: 4 }]);
    queueResponse({
      chunks: [Buffer.from(JSON.stringify({
        Status: 0,
        Answer: [{ type: 1, data: "93.184.216.34" }],
      }))],
    });
    queueResponse({ chunks: [Buffer.from("ok")] });

    await expect(requestPublicResponse("https://example.com"))
      .resolves.toMatchObject({ body: Buffer.from("ok") });
    expect(mocks.httpsRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({
      hostname: "1.1.1.1",
      servername: "cloudflare-dns.com",
    }), expect.any(Function));
    expect(mocks.httpsRequest).toHaveBeenNthCalledWith(2, expect.objectContaining({
      hostname: "93.184.216.34",
      servername: "example.com",
    }), expect.any(Function));
  });

  it("DoH 返回非公网地址时拒绝目标请求", async () => {
    mocks.dnsLookup.mockResolvedValue([{ address: "198.18.2.208", family: 4 }]);
    queueResponse({
      chunks: [Buffer.from(JSON.stringify({
        Status: 0,
        Answer: [{ type: 1, data: "127.0.0.1" }],
      }))],
    });

    await expect(requestPublicResponse("https://example.com"))
      .rejects.toMatchObject({ code: "blocked_url" });
    expect(mocks.httpsRequest).toHaveBeenCalledTimes(1);
  });

  it("Fake-IP 的 DoH 回退可被中止", async () => {
    const controller = new AbortController();
    mocks.dnsLookup.mockResolvedValue([{ address: "198.18.2.208", family: 4 }]);
    mocks.httpsRequest.mockImplementationOnce((requestOptions) => {
      const request = new EventEmitter() as EventEmitter & {
        end: () => void;
        destroy: (error: Error) => void;
      };
      request.destroy = (error) => request.emit("error", error);
      request.end = () => {};
      const signal = requestOptions.signal as AbortSignal;
      signal.addEventListener("abort", () => request.destroy(new Error("aborted")), { once: true });
      return request;
    });

    const pending = requestPublicResponse("https://example.com", { signal: controller.signal });
    await vi.waitFor(() => expect(mocks.httpsRequest).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(pending).rejects.toThrow("aborted");
  });

  it("把中止信号传递到底层请求", async () => {
    const controller = new AbortController();
    mocks.httpsRequest.mockImplementationOnce((requestOptions) => {
      const request = new EventEmitter() as EventEmitter & {
        end: () => void;
        destroy: (error: Error) => void;
      };
      request.destroy = (error) => request.emit("error", error);
      request.end = () => {};
      const signal = requestOptions.signal as AbortSignal;
      if (signal.aborted) queueMicrotask(() => request.destroy(new Error("aborted")));
      else signal.addEventListener("abort", () => request.destroy(new Error("aborted")), { once: true });
      return request;
    });

    const pending = requestPublicResponse("https://example.com", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
  });
});
