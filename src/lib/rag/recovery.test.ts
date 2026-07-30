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

import {
  recoverStaleFileProcessing,
  startFileProcessingRecovery,
} from "@/lib/rag/recovery";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("file processing recovery scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRecoverableFileIds.mockReset().mockResolvedValue([]);
    mocks.processFile.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("启动立即扫描且单飞运行，停止时等待在途扫描", async () => {
    vi.useFakeTimers();
    const firstScan = deferred();
    const recover = vi.fn().mockReturnValue(firstScan.promise);
    const intervalSpy = vi.spyOn(globalThis, "setInterval");

    const stop = startFileProcessingRecovery(recover);
    await Promise.resolve();
    expect(recover).toHaveBeenCalledOnce();
    const timer = intervalSpy.mock.results[0]?.value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);

    await vi.advanceTimersByTimeAsync(180_000);
    expect(recover).toHaveBeenCalledOnce();

    let stopped = false;
    const stopping = stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    firstScan.resolve();
    await stopping;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(recover).toHaveBeenCalledOnce();
  });

  it("扫描失败后下个周期仍会重试", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const recover = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue(undefined);

    const stop = startFileProcessingRecovery(recover);
    await vi.advanceTimersByTimeAsync(0);
    expect(recover).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(recover).toHaveBeenCalledTimes(2);

    await stop();
  });

  it("按 repository 返回的 id 顺序处理并隔离单项失败", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.findRecoverableFileIds.mockResolvedValue(["file-1", "file-2"]);
    mocks.processFile
      .mockRejectedValueOnce(
        new Error("postgresql://user:pass@db/app?token=secret"),
      )
      .mockResolvedValueOnce(undefined);

    await recoverStaleFileProcessing();

    expect(mocks.processFile.mock.calls).toEqual([["file-1"], ["file-2"]]);
    const logged = errorSpy.mock.calls.flat().join(" ");
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
