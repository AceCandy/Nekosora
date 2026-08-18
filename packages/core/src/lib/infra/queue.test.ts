import { afterEach, describe, expect, it, vi } from "vitest";

const QUEUE_PROVIDER = Symbol.for("@nekusora/core/queue-provider");
const queueState = globalThis as typeof globalThis & {
  [QUEUE_PROVIDER]?: unknown;
};

describe("queue provider", () => {
  afterEach(() => {
    delete queueState[QUEUE_PROVIDER];
  });

  it("未配置时拒绝，配置后跨模块实例返回 adapter", async () => {
    delete queueState[QUEUE_PROVIDER];
    vi.resetModules();
    const queueModule = await import("./queue");
    await expect(queueModule.getQueue()).rejects.toThrow("当前进程未配置队列驱动");

    const adapter = { available: true };
    const provider = vi.fn().mockResolvedValue(adapter);
    queueModule.configureQueueProvider(provider as never);

    vi.resetModules();
    const reloadedQueueModule = await import("./queue");
    await expect(reloadedQueueModule.getQueue()).resolves.toBe(adapter);
    expect(provider).toHaveBeenCalledOnce();
  });
});
