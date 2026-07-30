import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  parseFormData: vi.fn(),
  getStorage: vi.fn(),
  storagePut: vi.fn(),
  storageDelete: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  dbSelect: vi.fn(),
  dbFrom: vi.fn(),
  dbWhere: vi.fn(),
  dbLimit: vi.fn(),
  dbInsert: vi.fn(),
  dbValues: vi.fn(),
  getQueue: vi.fn(),
  queueSend: vi.fn(),
  processFile: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
}));

vi.mock("drizzle-orm", () => ({ eq: mocks.eq, and: mocks.and }));
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
vi.mock("@/lib/rag/processing-coordinator", () => ({ processFile: mocks.processFile }));

import { RequestBodyTooLargeError } from "@/lib/multipart";
import {
  MAX_UPLOAD_BODY_BYTES,
  MAX_UPLOAD_FILE_BYTES,
  POST,
} from "@/app/api/upload/route";

const schema = {
  conversations: {
    id: "conversations.id",
    userId: "conversations.userId",
  },
  fileObjects: {},
};

function request() {
  return new NextRequest("http://localhost/api/upload", { method: "POST" });
}

function uploadForm(size = 5, filename = "hello.txt", mime = "text/plain"): FormData {
  const formData = new FormData();
  const file = new File(["hello"], filename, { type: mime });
  Object.defineProperty(file, "size", { value: size });
  formData.set("file", file);
  formData.set("conversationId", "conversation-1");
  return formData;
}

describe("POST /api/upload", () => {
  beforeEach(() => {
    mocks.eq.mockClear();
    mocks.and.mockClear();
    mocks.getSession.mockReset().mockResolvedValue({ id: "user-1" });
    mocks.parseFormData.mockReset().mockResolvedValue(uploadForm());
    mocks.storagePut.mockReset().mockResolvedValue(undefined);
    mocks.storageDelete.mockReset().mockResolvedValue(undefined);
    mocks.getStorage.mockReset().mockResolvedValue({
      put: mocks.storagePut,
      delete: mocks.storageDelete,
    });
    mocks.dbLimit.mockReset().mockResolvedValue([{ id: "conversation-1" }]);
    mocks.dbWhere.mockReset().mockReturnValue({ limit: mocks.dbLimit });
    mocks.dbFrom.mockReset().mockReturnValue({ where: mocks.dbWhere });
    mocks.dbSelect.mockReset().mockReturnValue({ from: mocks.dbFrom });
    mocks.dbInsert.mockReset().mockReturnValue({ values: mocks.dbValues });
    mocks.dbValues.mockReset().mockResolvedValue(undefined);
    mocks.getDb.mockReset().mockResolvedValue({
      select: mocks.dbSelect,
      insert: mocks.dbInsert,
    });
    mocks.getSchema.mockReset().mockReturnValue(schema);
    mocks.queueSend.mockReset().mockResolvedValue(undefined);
    mocks.getQueue.mockReset().mockResolvedValue({
      available: true,
      send: mocks.queueSend,
    });
    mocks.processFile.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(mocks.dbSelect).toHaveBeenCalledWith({ id: schema.conversations.id });
    expect(mocks.dbFrom).toHaveBeenCalledWith(schema.conversations);
    expect(mocks.dbWhere).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        { op: "eq", left: schema.conversations.id, right: "conversation-1" },
        { op: "eq", left: schema.conversations.userId, right: "user-1" },
      ],
    });
    expect(mocks.dbLimit).toHaveBeenCalledWith(1);
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
    expect(mocks.storageDelete).not.toHaveBeenCalled();
    expect(mocks.processFile).not.toHaveBeenCalled();
  });

  it.each([
    ["其他用户", "conversation-foreign"],
    ["不存在", "conversation-missing"],
  ])("%s会话返回统一 403 且不产生上传副作用", async (_kind, conversationId) => {
    const formData = uploadForm();
    formData.set("conversationId", conversationId);
    mocks.parseFormData.mockResolvedValue(formData);
    mocks.dbLimit.mockResolvedValue([]);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "会话不存在或无权访问" });
    expect(mocks.eq).toHaveBeenCalledWith(schema.conversations.id, conversationId);
    expect(mocks.eq).toHaveBeenCalledWith(schema.conversations.userId, "user-1");
    expect(mocks.and).toHaveBeenCalledWith(
      { op: "eq", left: schema.conversations.id, right: conversationId },
      { op: "eq", left: schema.conversations.userId, right: "user-1" },
    );
    expect(mocks.getStorage).not.toHaveBeenCalled();
    expect(mocks.dbInsert).not.toHaveBeenCalled();
    expect(mocks.getQueue).not.toHaveBeenCalled();
    expect(mocks.processFile).not.toHaveBeenCalled();
  });

  it("空会话 ID 跳过属主查询并写入 null", async () => {
    const formData = uploadForm();
    formData.set("conversationId", "");
    mocks.parseFormData.mockResolvedValue(formData);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.dbSelect).not.toHaveBeenCalled();
    expect(mocks.dbValues).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: null }),
    );
  });

  it("会话属主查询失败时不产生上传副作用", async () => {
    const dbError = new Error("db unavailable");
    mocks.dbLimit.mockRejectedValue(dbError);

    await expect(POST(request())).rejects.toBe(dbError);

    expect(mocks.getStorage).not.toHaveBeenCalled();
    expect(mocks.dbInsert).not.toHaveBeenCalled();
    expect(mocks.getQueue).not.toHaveBeenCalled();
    expect(mocks.processFile).not.toHaveBeenCalled();
  });

  it("DB 插入失败时删除已写入对象并保留原始异常", async () => {
    const dbError = new Error("db unavailable");
    mocks.dbValues.mockRejectedValue(dbError);

    await expect(POST(request())).rejects.toBe(dbError);

    const storagePath = mocks.storagePut.mock.calls[0][0] as string;
    expect(mocks.storageDelete).toHaveBeenCalledOnce();
    expect(mocks.storageDelete).toHaveBeenCalledWith(storagePath);
    expect(mocks.getQueue).not.toHaveBeenCalled();
  });

  it("DB 获取失败时不写入存储对象", async () => {
    const dbError = new Error("db unavailable");
    mocks.getDb.mockRejectedValue(dbError);

    await expect(POST(request())).rejects.toBe(dbError);

    expect(mocks.getStorage).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.storageDelete).not.toHaveBeenCalled();
    expect(mocks.getQueue).not.toHaveBeenCalled();
  });

  it("Schema 获取失败时不写入存储对象", async () => {
    const dbError = new Error("schema unavailable");
    mocks.getSchema.mockImplementation(() => {
      throw dbError;
    });

    await expect(POST(request())).rejects.toBe(dbError);

    expect(mocks.dbSelect).not.toHaveBeenCalled();
    expect(mocks.getStorage).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.storageDelete).not.toHaveBeenCalled();
    expect(mocks.getQueue).not.toHaveBeenCalled();
  });

  it("补偿删除失败时记录清理错误但仍保留 DB 异常", async () => {
    const dbError = new Error("db unavailable");
    const cleanupError = new Error("storage unavailable");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.dbValues.mockRejectedValue(dbError);
    mocks.storageDelete.mockRejectedValue(cleanupError);

    await expect(POST(request())).rejects.toBe(dbError);

    expect(mocks.storageDelete).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "[upload] failed to clean up stored file:",
      cleanupError,
    );
    expect(mocks.getQueue).not.toHaveBeenCalled();
  });

  it("存储写入失败时不触达文件插入、补偿删除或队列", async () => {
    const storageError = new Error("storage unavailable");
    mocks.storagePut.mockRejectedValue(storageError);

    await expect(POST(request())).rejects.toBe(storageError);

    expect(mocks.getDb).toHaveBeenCalledOnce();
    expect(mocks.dbSelect).toHaveBeenCalledOnce();
    expect(mocks.dbInsert).not.toHaveBeenCalled();
    expect(mocks.storageDelete).not.toHaveBeenCalled();
    expect(mocks.getQueue).not.toHaveBeenCalled();
  });

  it("队列获取失败时记录错误并回退同步处理", async () => {
    const queueError = new Error("queue unavailable postgresql://user:pass@db/app");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getQueue.mockRejectedValue(queueError);

    const response = await POST(request());
    const body = await response.json();
    const storagePath = mocks.storagePut.mock.calls[0][0] as string;

    expect(response.status).toBe(200);
    expect(consoleError).toHaveBeenCalledWith(
      "[upload] queue dispatch failed, using sync fallback:",
      "queue unavailable [REDACTED]",
    );
    expect(mocks.processFile).toHaveBeenCalledOnce();
    expect(mocks.processFile).toHaveBeenCalledWith(body.fileId);
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain(storagePath);
  });

  it("队列投递失败时保留对象与 DB 行并回退同步处理", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.parseFormData.mockResolvedValue(uploadForm(5, "hello.bin", ""));
    mocks.queueSend.mockImplementation((_name, payload) => Promise.reject(
      new Error(`send failed ${payload.storagePath}?token=secret`),
    ));

    const response = await POST(request());
    const body = await response.json();
    const storagePath = mocks.storagePut.mock.calls[0][0] as string;

    expect(response.status).toBe(200);
    expect(consoleError).toHaveBeenCalledWith(
      "[upload] queue dispatch failed, using sync fallback:",
      "send failed [REDACTED]?token=[REDACTED]",
    );
    expect(mocks.processFile).toHaveBeenCalledOnce();
    expect(mocks.processFile).toHaveBeenCalledWith(body.fileId);
    expect(mocks.storagePut).toHaveBeenCalledWith(
      storagePath,
      Buffer.from("hello"),
      "application/octet-stream",
    );
    expect(mocks.dbValues).toHaveBeenCalledWith(
      expect.objectContaining({ mime: "application/octet-stream" }),
    );
    expect(mocks.storageDelete).not.toHaveBeenCalled();
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain(storagePath);
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("secret");
  });

  it("队列显式不可用时直接回退且不记录队列异常", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getQueue.mockResolvedValue({
      available: false,
      send: mocks.queueSend,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.queueSend).not.toHaveBeenCalled();
    expect(mocks.processFile).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("同步 fallback 失败时记录错误且上传仍成功", async () => {
    const processError = new Error(
      "processing failed https://provider.example/v1?api_key=secret",
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getQueue.mockResolvedValue({
      available: false,
      send: mocks.queueSend,
    });
    mocks.processFile.mockRejectedValue(processError);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "[upload] sync process failed:",
        "processing failed [REDACTED]",
      );
    });
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("provider.example");
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("secret");
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
