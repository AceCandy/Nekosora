import { describe, expect, it, vi } from "vitest";
import {
  clearShareUnlockClientFailures,
  getShareUnlockRetryAfter,
  recordShareUnlockFailure,
} from "./share-rate-limit";

describe("conversation share unlock rate limit", () => {
  it("返回仍在封锁期内的最大重试秒数", async () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const execute = vi.fn().mockResolvedValue({
      rows: [
        { blocked_until: new Date("2026-07-27T00:00:05.000Z") },
        { blocked_until: new Date("2026-07-27T00:00:12.000Z") },
      ],
    });
    await expect(getShareUnlockRetryAfter({ execute }, "share-1", "client-1", now)).resolves.toBe(12);
  });

  it("同一事务递增客户端桶与分享全局桶", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const transaction = vi.fn(async (callback: (tx: { execute: typeof execute }) => Promise<void>) => callback({ execute }));
    await recordShareUnlockFailure({ transaction }, "share-1", "client-1", new Date());
    expect(transaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("成功解锁只删除当前客户端桶", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    await clearShareUnlockClientFailures({ execute }, "share-1", "client-1");
    expect(execute).toHaveBeenCalledOnce();
  });
});
