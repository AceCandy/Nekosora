import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:http", () => ({ request: mocks.request }));
vi.mock("node:https", () => ({ request: mocks.request }));

import { createModelDownload } from "./download";

const image = { url: new URL("https://images.example/test.png"), isUrlSupportedByModel: false };

function queueResponse(status = 200, headers: Record<string, string> = { "content-type": "image/png" }) {
  mocks.request.mockImplementationOnce((_options, callback) => {
    const request = new EventEmitter();
    return Object.assign(request, {
      end() {
        const response = Object.assign(new PassThrough(), { statusCode: status, headers });
        queueMicrotask(() => {
          callback(response);
          if (!response.destroyed) response.end(Buffer.from("image"));
        });
      },
      destroy(error: Error) { request.emit("error", error); },
    });
  });
}

describe("模型图片安全下载", () => {
  beforeEach(() => {
    mocks.lookup.mockReset().mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
    mocks.request.mockReset();
  });

  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1"])("下载前拒绝域名解析到 %s", async (address) => {
    mocks.lookup.mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
    await expect(createModelDownload()([image])).rejects.toMatchObject({ code: "blocked_url" });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("固定到已校验 IP，并保留 Host、SNI、MIME 与取消信号", async () => {
    queueResponse();
    const controller = new AbortController();
    await expect(createModelDownload(controller.signal)([image])).resolves.toEqual([
      { data: Buffer.from("image"), mediaType: "image/png" },
    ]);
    expect(mocks.lookup).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      hostname: "1.1.1.1", servername: "images.example",
      headers: { Host: "images.example" }, signal: controller.signal,
    }), expect.any(Function));
  });

  it("公网 IPv6 字面量直接连接，Host 保留方括号且不进行 DNS 查询", async () => {
    queueResponse();
    await expect(createModelDownload()([{
      ...image, url: new URL("https://[2606:4700:4700::1111]/image.png"),
    }])).resolves.toEqual([{ data: Buffer.from("image"), mediaType: "image/png" }]);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      hostname: "2606:4700:4700::1111", family: 6, servername: undefined,
      headers: { Host: "[2606:4700:4700::1111]" },
    }), expect.any(Function));
  });

  it.each(["::1", "fd00::1", "::ffff:127.0.0.1"])("拒绝私网 IPv6 字面量 %s", async (address) => {
    await expect(createModelDownload()([{
      ...image, url: new URL(`https://[${address}]/image.png`),
    }])).rejects.toMatchObject({ code: "blocked_url" });
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("重定向域名解析到内网时不连接下一跳", async () => {
    mocks.lookup.mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    queueResponse(302, { location: "https://redirect.example/private" });
    await expect(createModelDownload()([image])).rejects.toMatchObject({ code: "blocked_url" });
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it("保留模型可直接读取的 URL，不由本服务下载", async () => {
    await expect(createModelDownload()([{ ...image, isUrlSupportedByModel: true }])).resolves.toEqual([null]);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("拒绝超出 SDK 原有 100 MiB 上限的响应", async () => {
    queueResponse(200, { "content-length": String(100 * 1024 * 1024 + 1) });
    await expect(createModelDownload()([image])).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("拒绝失败 HTTP 响应", async () => {
    queueResponse(404);
    await expect(createModelDownload()([image])).rejects.toThrow("图片下载失败");
  });

  it("取消能结束挂起的 DNS 查询", async () => {
    mocks.lookup.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = createModelDownload(controller.signal)([image]);
    controller.abort(new DOMException("Aborted", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
