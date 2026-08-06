import { describe, expect, it, vi } from "vitest";

describe("queue provider", () => {
  it("未配置时拒绝，配置后返回进程持有的 adapter", async () => {
    vi.resetModules();
    const queueModule = await import("./queue");
    await expect(queueModule.getQueue()).rejects.toThrow("当前进程未配置队列驱动");

    const adapter = { available: true };
    const provider = vi.fn().mockResolvedValue(adapter);
    queueModule.configureQueueProvider(provider as never);

    await expect(queueModule.getQueue()).resolves.toBe(adapter);
    expect(provider).toHaveBeenCalledOnce();
  });
});
