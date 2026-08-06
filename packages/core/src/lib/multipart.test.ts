import { describe, expect, it, vi } from "vitest";
import {
  parseBoundedMultipartFormData,
  RequestBodyTooLargeError,
} from "@/lib/multipart";

function requestWithStream(
  stream: ReadableStream<Uint8Array>,
  headers?: HeadersInit,
): Request {
  return new Request("http://localhost/upload", {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("parseBoundedMultipartFormData", () => {
  it("Content-Length 已超限时不读取 body", async () => {
    const request = requestWithStream(new ReadableStream(), {
      "content-length": "6",
      "content-type": "multipart/form-data; boundary=test",
    });
    const getReader = vi.spyOn(request.body!, "getReader");

    await expect(parseBoundedMultipartFormData(request, 5)).rejects.toEqual(
      new RequestBodyTooLargeError(5),
    );
    expect(getReader).not.toHaveBeenCalled();
  });

  it("实际 chunk 累计超限时 cancel 请求流", async () => {
    const cancel = vi.fn();
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
    const request = requestWithStream(
      new ReadableStream({
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk) controller.enqueue(chunk);
          else controller.close();
        },
        cancel,
      }),
      { "content-type": "multipart/form-data; boundary=test" },
    );

    await expect(parseBoundedMultipartFormData(request, 5)).rejects.toEqual(
      new RequestBodyTooLargeError(5),
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("限额内请求解析 file 与文本字段", async () => {
    const input = new FormData();
    input.set("conversationId", "conversation-1");
    input.set(
      "file",
      new File(["hello"], "hello.txt", { type: "text/plain" }),
    );
    const request = new Request("http://localhost/upload", {
      method: "POST",
      body: input,
    });

    const result = await parseBoundedMultipartFormData(request, 1024);
    const file = result.get("file");

    expect(result.get("conversationId")).toBe("conversation-1");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("hello.txt");
    expect(await (file as File).text()).toBe("hello");
  });

  it("Content-Length 小于实际值时仍按实际流解析", async () => {
    const input = new FormData();
    input.set("file", new File(["hello"], "hello.txt"));
    const original = new Request("http://localhost/upload", {
      method: "POST",
      body: input,
    });
    const headers = new Headers(original.headers);
    headers.set("content-length", "1");
    const request = requestWithStream(original.body!, headers);

    const result = await parseBoundedMultipartFormData(request, 1024);

    expect(await (result.get("file") as File).text()).toBe("hello");
  });
});
