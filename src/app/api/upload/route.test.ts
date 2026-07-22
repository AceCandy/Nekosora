import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  parseFormData: vi.fn(),
  getStorage: vi.fn(),
  storagePut: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  dbValues: vi.fn(),
  getQueue: vi.fn(),
  queueSend: vi.fn(),
  processFile: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/multipart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/multipart")>();
  return { ...actual, parseBoundedMultipartFormData: mocks.parseFormData };
});
vi.mock("@/lib/infra/storage", () => ({ getStorage: mocks.getStorage }));
vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));
vi.mock("@/lib/infra/queue", () => ({ getQueue: mocks.getQueue }));
vi.mock("@/lib/rag/process", () => ({ processFile: mocks.processFile }));

import { RequestBodyTooLargeError } from "@/lib/multipart";
import {
  MAX_UPLOAD_BODY_BYTES,
  MAX_UPLOAD_FILE_BYTES,
  POST,
} from "@/app/api/upload/route";

function request() {
  return new NextRequest("http://localhost/api/upload", { method: "POST" });
}

function uploadForm(size = 5, filename = "hello.txt"): FormData {
  const formData = new FormData();
  const file = new File(["hello"], filename, { type: "text/plain" });
  Object.defineProperty(file, "size", { value: size });
  formData.set("file", file);
  formData.set("conversationId", "conversation-1");
  return formData;
}

describe("POST /api/upload", () => {
  beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue({ id: "user-1" });
    mocks.parseFormData.mockReset().mockResolvedValue(uploadForm());
    mocks.storagePut.mockReset().mockResolvedValue(undefined);
    mocks.getStorage.mockReset().mockResolvedValue({ put: mocks.storagePut });
    mocks.dbValues.mockReset().mockResolvedValue(undefined);
    mocks.getDb.mockReset().mockResolvedValue({
      insert: () => ({ values: mocks.dbValues }),
    });
    mocks.getSchema.mockReset().mockReturnValue({ fileObjects: {} });
    mocks.queueSend.mockReset().mockResolvedValue(undefined);
    mocks.getQueue.mockReset().mockResolvedValue({
      available: true,
      send: mocks.queueSend,
    });
    mocks.processFile.mockReset();
  });

  it("multipart 总体超限时返回标准 413 且不触达后端", async () => {
    mocks.parseFormData.mockRejectedValue(
      new RequestBodyTooLargeError(MAX_UPLOAD_BODY_BYTES),
    );
    const req = request();

    const response = await POST(req);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "request.payload_too_large", type: "invalid_request_error" },
    });
    expect(mocks.parseFormData).toHaveBeenCalledWith(req, MAX_UPLOAD_BODY_BYTES);
    expect(mocks.getStorage).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.getQueue).not.toHaveBeenCalled();
  });

  it("实际文件超限时返回标准 413 且不触达后端", async () => {
    mocks.parseFormData.mockResolvedValue(uploadForm(MAX_UPLOAD_FILE_BYTES + 1));

    const response = await POST(request());

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "request.payload_too_large" },
    });
    expect(mocks.getStorage).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.getQueue).not.toHaveBeenCalled();
  });

  it("合法文件保持存储、落库与入队流程", async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ filename: "hello.txt", status: "processing" });
    expect(mocks.storagePut).toHaveBeenCalledWith(
      expect.stringMatching(/^user-1\/.+-hello\.txt$/),
      Buffer.from("hello"),
      "text/plain",
    );
    expect(mocks.dbValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        conversationId: "conversation-1",
        filename: "hello.txt",
        size: 5,
      }),
    );
    expect(mocks.queueSend).toHaveBeenCalledWith(
      "file-process",
      expect.objectContaining({ mime: "text/plain" }),
    );
  });

  it.each(["../../../escape.txt", "..\\..\\escape.txt"])(
    "清洗路径型 filename:%s",
    async (filename) => {
      mocks.parseFormData.mockResolvedValue(uploadForm(5, filename));

      const response = await POST(request());
      const body = await response.json();
      const storagePath = mocks.storagePut.mock.calls[0][0] as string;

      expect(response.status).toBe(200);
      expect(body.filename).toBe("escape.txt");
      expect(storagePath).toMatch(/^user-1\/[0-9a-f-]+-escape\.txt$/);
      expect(storagePath).not.toContain("..");
      expect(mocks.dbValues).toHaveBeenCalledWith(
        expect.objectContaining({ filename: "escape.txt", storagePath }),
      );
    },
  );

  it.each([
    [" \u0000\u0001 ", "file"],
    [".", "file"],
    ["..", "file"],
    ["a\u0000b.txt", "ab.txt"],
  ])("清洗空值或控制字符 filename:%s", async (filename, expected) => {
    mocks.parseFormData.mockResolvedValue(uploadForm(5, filename));

    const response = await POST(request());
    const storagePath = mocks.storagePut.mock.calls[0][0] as string;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ filename: expected });
    expect(storagePath).toMatch(/^user-1\/[0-9a-f-]+-/);
    expect(storagePath.endsWith(`-${expected}`)).toBe(true);
    expect(mocks.dbValues).toHaveBeenCalledWith(
      expect.objectContaining({ filename: expected, storagePath }),
    );
  });
});
