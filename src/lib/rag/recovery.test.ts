import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRecoverableFileIds: vi.fn(),
  processFile: vi.fn(),
}));

vi.mock("@/lib/rag/processing-repository", () => ({
  findRecoverableFileIds: mocks.findRecoverableFileIds,
}));
vi.mock("@/lib/rag/processing-coordinator", () => ({
  processFile: mocks.processFile,
}));

import { recoverStaleFileProcessing } from "@/lib/rag/recovery";

describe("file processing recovery scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRecoverableFileIds.mockReset().mockResolvedValue([]);
    mocks.processFile.mockReset().mockResolvedValue("completed");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("按 repository 返回的 id 顺序处理并隔离单项失败", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.findRecoverableFileIds.mockResolvedValue(["file-1", "file-2"]);
    mocks.processFile
      .mockRejectedValueOnce(
        new Error("postgresql://user:pass@db/app?token=secret"),
      )
      .mockResolvedValueOnce("completed");

    await recoverStaleFileProcessing();

    expect(mocks.processFile.mock.calls).toEqual([["file-1"], ["file-2"]]);
    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(errorSpy).toHaveBeenCalledWith("[file-processing-recovery] failed");
    expect(logged).not.toContain("file-1");
    expect(logged).not.toContain("postgresql://");
    expect(logged).not.toContain("secret");
    expect(logged.length).toBeLessThanOrEqual(260);
  });

  it("候选查询失败向 scheduler 传播", async () => {
    const error = new Error("database unavailable");
    mocks.findRecoverableFileIds.mockRejectedValue(error);

    await expect(recoverStaleFileProcessing()).rejects.toBe(error);
    expect(mocks.processFile).not.toHaveBeenCalled();
  });
});
