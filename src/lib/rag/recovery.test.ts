import { afterEach, describe, expect, it, vi } from "vitest";
import { startFileProcessingRecovery } from "@/lib/rag/recovery";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("file processing recovery scheduler", () => {
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
});
