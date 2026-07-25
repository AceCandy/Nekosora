import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  getStorage: vi.fn(),
  storageGet: vi.fn(),
  storageSignedUrl: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
}));
vi.mock("@/lib/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));
vi.mock("@/lib/infra/storage", () => ({ getStorage: mocks.getStorage }));

import { GET } from "@/app/api/files/[fileId]/route";

const file = {
  id: "file-a",
  userId: "user-a",
  storagePath: "user-a/sample.txt",
  filename: "sample.txt",
  mime: "text/plain",
  size: 10,
};

function request(range?: string) {
  return new NextRequest("http://localhost/api/files/file-a", {
    headers: range ? { Range: range } : undefined,
  });
}

describe("GET /api/files/[fileId]", () => {
  beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue({ id: "user-a" });
    mocks.getSchema.mockReset().mockReturnValue({ fileObjects: { id: "id" } });
    mocks.getDb.mockReset().mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [file],
          }),
        }),
      }),
    });
    mocks.storageGet.mockReset().mockResolvedValue(Buffer.from("2345"));
    mocks.storageSignedUrl.mockReset();
    mocks.getStorage.mockReset().mockResolvedValue({
      kind: "local",
      publicReadable: false,
      get: mocks.storageGet,
      signedUrl: mocks.storageSignedUrl,
    });
  });

  it("未登录时返回 401 且不访问数据库或存储", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await GET(request(), {
      params: Promise.resolve({ fileId: "file-a" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.getStorage).not.toHaveBeenCalled();
  });

  it("非属主访问时返回 404 且不读取存储", async () => {
    mocks.getDb.mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ ...file, userId: "other-user" }],
          }),
        }),
      }),
    });

    const response = await GET(request(), {
      params: Promise.resolve({ fileId: "file-a" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.getStorage).not.toHaveBeenCalled();
    expect(mocks.storageGet).not.toHaveBeenCalled();
    expect(mocks.storageSignedUrl).not.toHaveBeenCalled();
  });

  it("合法单段 Range 返回 206 和对应字节", async () => {
    const response = await GET(request("bytes=2-5"), {
      params: Promise.resolve({ fileId: "file-a" }),
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(await response.text()).toBe("2345");
    expect(mocks.storageGet).toHaveBeenCalledWith("user-a/sample.txt", {
      start: 2,
      end: 5,
    });
  });

  it("不可满足的 Range 返回 416 且不读取存储", async () => {
    const response = await GET(request("bytes=10-"), {
      params: Promise.resolve({ fileId: "file-a" }),
    });

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */10");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(mocks.getStorage).not.toHaveBeenCalled();
    expect(mocks.storageGet).not.toHaveBeenCalled();
  });

  it("无 Range 时保持 200 全量响应", async () => {
    mocks.storageGet.mockResolvedValue(Buffer.from("0123456789"));

    const response = await GET(request(), {
      params: Promise.resolve({ fileId: "file-a" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Range")).toBeNull();
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(await response.text()).toBe("0123456789");
    expect(mocks.storageGet).toHaveBeenCalledWith("user-a/sample.txt");
  });

  it("S3 类存储的合法 Range 仍走预签名重定向", async () => {
    mocks.storageSignedUrl.mockResolvedValue(
      "https://storage.example.com/sample.txt?X-Amz-Signature=signed",
    );
    mocks.getStorage.mockResolvedValue({
      kind: "s3",
      publicReadable: false,
      get: mocks.storageGet,
      signedUrl: mocks.storageSignedUrl,
    });

    const response = await GET(request("bytes=2-5"), {
      params: Promise.resolve({ fileId: "file-a" }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://storage.example.com/sample.txt?X-Amz-Signature=signed",
    );
    expect(mocks.storageSignedUrl).toHaveBeenCalledWith("user-a/sample.txt", 3600);
    expect(mocks.storageGet).not.toHaveBeenCalled();
  });

  it("配置公共产物 URL 的 S3 私有文件由应用代理完整读取", async () => {
    mocks.storageGet.mockResolvedValue(Buffer.from("0123456789"));
    mocks.getStorage.mockResolvedValue({
      kind: "s3",
      publicReadable: true,
      get: mocks.storageGet,
      signedUrl: mocks.storageSignedUrl,
    });

    const response = await GET(request(), {
      params: Promise.resolve({ fileId: "file-a" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    expect(await response.text()).toBe("0123456789");
    expect(mocks.storageSignedUrl).not.toHaveBeenCalled();
    expect(mocks.storageGet).toHaveBeenCalledWith("user-a/sample.txt");
  });

  it("配置公共产物 URL 的 S3 私有文件由应用代理 Range 读取", async () => {
    mocks.getStorage.mockResolvedValue({
      kind: "s3",
      publicReadable: true,
      get: mocks.storageGet,
      signedUrl: mocks.storageSignedUrl,
    });

    const response = await GET(request("bytes=2-5"), {
      params: Promise.resolve({ fileId: "file-a" }),
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(await response.text()).toBe("2345");
    expect(mocks.storageSignedUrl).not.toHaveBeenCalled();
    expect(mocks.storageGet).toHaveBeenCalledWith("user-a/sample.txt", {
      start: 2,
      end: 5,
    });
  });
});
