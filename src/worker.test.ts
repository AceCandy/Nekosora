import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQueue: vi.fn(),
  processFile: vi.fn(),
  extractMemories: vi.fn(),
  generateConversationTitle: vi.fn(),
  startFileProcessingRecovery: vi.fn(),
}));

vi.mock("@/lib/infra/queue", () => ({ getQueue: mocks.getQueue }));
vi.mock("@/lib/rag/process", () => ({ processFile: mocks.processFile }));
vi.mock("@/lib/memory/extract", () => ({ extractMemories: mocks.extractMemories }));
vi.mock("@/lib/conversation-title/service", () => ({
  generateConversationTitle: mocks.generateConversationTitle,
}));
vi.mock("@/lib/rag/recovery", () => ({
  startFileProcessingRecovery: mocks.startFileProcessingRecovery,
}));

describe("worker lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("注册任务后启动恢复，并单飞执行有序关闭", async () => {
    const calls: string[] = [];
    const queue = {
      start: vi.fn(async () => {
        calls.push("queue.start");
      }),
      work: vi.fn(async (name: string) => {
        calls.push(`queue.work:${name}`);
      }),
      stop: vi.fn(async () => {
        calls.push("queue.stop");
      }),
    };
    const stopRecovery = vi.fn(async () => {
      calls.push("recovery.stop");
    });
    mocks.getQueue.mockResolvedValue(queue);
    mocks.startFileProcessingRecovery.mockImplementation(() => {
      calls.push("recovery.start");
      return stopRecovery;
    });
    const handlers = new Map<string, () => Promise<void>>();
    const runtime = {
      on: vi.fn((signal: string, handler: () => Promise<void>) => {
        handlers.set(signal, handler);
      }),
      exit: vi.fn(() => {
        calls.push("runtime.exit");
      }),
    };
    const { startWorker } = await import("@/worker");

    await startWorker(runtime);

    expect(calls).toEqual([
      "queue.start",
      "queue.work:file-process",
      "queue.work:memory-extract",
      "queue.work:conversation-title",
      "recovery.start",
    ]);
    const firstShutdown = handlers.get("SIGINT")!();
    const secondShutdown = handlers.get("SIGTERM")!();
    await Promise.all([firstShutdown, secondShutdown]);
    expect(calls.slice(-3)).toEqual([
      "recovery.stop",
      "queue.stop",
      "runtime.exit",
    ]);
    expect(stopRecovery).toHaveBeenCalledOnce();
    expect(queue.stop).toHaveBeenCalledOnce();
    expect(runtime.exit).toHaveBeenCalledOnce();
  });

  it("恢复调度启动失败时停止已启动的队列并保留原错误", async () => {
    const startupError = new Error("recovery startup failed");
    const queue = {
      start: vi.fn().mockResolvedValue(undefined),
      work: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getQueue.mockResolvedValue(queue);
    mocks.startFileProcessingRecovery.mockImplementation(() => {
      throw startupError;
    });
    const runtime = {
      on: vi.fn(),
      exit: vi.fn(),
    };
    const { startWorker } = await import("@/worker");

    await expect(startWorker(runtime)).rejects.toBe(startupError);

    expect(queue.stop).toHaveBeenCalledOnce();
    expect(runtime.on).not.toHaveBeenCalled();
    expect(runtime.exit).not.toHaveBeenCalled();
  });

  it("handler 注册失败时停止队列并保留原错误", async () => {
    const registrationError = new Error("handler registration failed");
    const queue = {
      start: vi.fn().mockResolvedValue(undefined),
      work: vi.fn(async (name: string) => {
        if (name === "memory-extract") throw registrationError;
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getQueue.mockResolvedValue(queue);
    mocks.startFileProcessingRecovery.mockReturnValue(vi.fn());
    const runtime = {
      on: vi.fn(),
      exit: vi.fn(),
    };
    const { startWorker } = await import("@/worker");

    await expect(startWorker(runtime)).rejects.toBe(registrationError);

    expect(queue.stop).toHaveBeenCalledOnce();
    expect(mocks.startFileProcessingRecovery).not.toHaveBeenCalled();
    expect(runtime.on).not.toHaveBeenCalled();
  });

  it("停止恢复失败时仍停止队列并以失败码退出", async () => {
    const shutdownError = new Error("recovery stop failed");
    const queue = {
      start: vi.fn().mockResolvedValue(undefined),
      work: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const stopRecovery = vi.fn().mockRejectedValue(shutdownError);
    mocks.getQueue.mockResolvedValue(queue);
    mocks.startFileProcessingRecovery.mockReturnValue(stopRecovery);
    const handlers = new Map<string, () => Promise<void>>();
    const runtime = {
      on: vi.fn((signal: string, handler: () => Promise<void>) => {
        handlers.set(signal, handler);
      }),
      exit: vi.fn(),
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { startWorker } = await import("@/worker");
    await startWorker(runtime);

    await expect(handlers.get("SIGTERM")!()).resolves.toBeUndefined();

    expect(stopRecovery).toHaveBeenCalledOnce();
    expect(queue.stop).toHaveBeenCalledOnce();
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });
});
