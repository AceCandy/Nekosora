import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BEST_EFFORT_TIMEOUT_MS,
  BestEffortTimeoutError,
  withBestEffortTimeout,
} from "./best-effort";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("withBestEffortTimeout", () => {
  it("保留快速 resolve/reject 并清理 timeout timer", async () => {
    vi.useFakeTimers();

    await expect(withBestEffortTimeout(async () => "ok")).resolves.toBe("ok");
    expect(vi.getTimerCount()).toBe(0);

    await expect(
      withBestEffortTimeout(async () => {
        throw new Error("db down");
      }),
    ).rejects.toThrow("db down");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("等待超时后 reject,底层 late reject 不形成未处理异常", async () => {
    vi.useFakeTimers();
    const operation = deferred<never>();
    const wait = withBestEffortTimeout(() => operation.promise);
    const assertion = expect(wait).rejects.toEqual(
      new BestEffortTimeoutError(BEST_EFFORT_TIMEOUT_MS),
    );

    await vi.advanceTimersByTimeAsync(BEST_EFFORT_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);

    operation.reject(new Error("late db failure"));
    await Promise.resolve();
  });

  it("运行时支持时 unref timeout timer", async () => {
    const unref = vi.fn();
    const timer = { unref };
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockReturnValue(timer as unknown as ReturnType<typeof setTimeout>);
    const clearTimeoutSpy = vi
      .spyOn(globalThis, "clearTimeout")
      .mockImplementation(() => {});

    await expect(withBestEffortTimeout(async () => "ok")).resolves.toBe("ok");

    expect(setTimeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      BEST_EFFORT_TIMEOUT_MS,
    );
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
  });
});
