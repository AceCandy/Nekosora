import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQueue: vi.fn(),
  processFile: vi.fn(),
  extractMemories: vi.fn(),
  generateConversationTitle: vi.fn(),
  startFileProcessingRecovery: vi.fn(),
  startConversationTitleRecovery: vi.fn(),
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
vi.mock("@/lib/conversation-title/dispatch", () => ({
  startConversationTitleRecovery: mocks.startConversationTitleRecovery,
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
    const stopFileRecovery = vi.fn(async () => {
      calls.push("file-recovery.stop");
    });
    const stopTitleRecovery = vi.fn(async () => {
      calls.push("title-recovery.stop");
    });
    mocks.getQueue.mockResolvedValue(queue);
    mocks.startFileProcessingRecovery.mockImplementation(() => {
      calls.push("file-recovery.start");
      return stopFileRecovery;
    });
    mocks.startConversationTitleRecovery.mockImplementation(() => {
      calls.push("title-recovery.start");
      return stopTitleRecovery;
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
      "file-recovery.start",
      "title-recovery.start",
    ]);
    const firstShutdown = handlers.get("SIGINT")!();
    const secondShutdown = handlers.get("SIGTERM")!();
    await Promise.all([firstShutdown, secondShutdown]);
    expect(calls.slice(-4)).toEqual([
      "title-recovery.stop",
      "file-recovery.stop",
      "queue.stop",
      "runtime.exit",
    ]);
    expect(stopFileRecovery).toHaveBeenCalledOnce();
    expect(stopTitleRecovery).toHaveBeenCalledOnce();
    expect(queue.stop).toHaveBeenCalledOnce();
    expect(runtime.exit).toHaveBeenCalledOnce();
  });

  it("会话标题 handler 传播生成失败供队列重试", async () => {
    const taskHandlers = new Map<string, (data: unknown) => Promise<void>>();
    const queue = {
      start: vi.fn().mockResolvedValue(undefined),
      work: vi.fn(async (name: string, handler: (data: unknown) => Promise<void>) => {
        taskHandlers.set(name, handler);
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getQueue.mockResolvedValue(queue);
    mocks.startFileProcessingRecovery.mockReturnValue(vi.fn());
    mocks.startConversationTitleRecovery.mockReturnValue(vi.fn());
    const runtime = {
      on: vi.fn(),
      exit: vi.fn(),
    };
    const generationError = new Error("title generation failed");
    mocks.generateConversationTitle.mockRejectedValueOnce(generationError);
    const { startWorker } = await import("@/worker");
    await startWorker(runtime);

    await expect(taskHandlers.get("conversation-title")!({
      userId: "u1",
      id: "job-1",
      conversationId: "c1",
      firstUserMessage: "问题",
      fallbackTitle: "问题",
    })).rejects.toBe(generationError);
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
    mocks.startConversationTitleRecovery.mockReturnValue(vi.fn());
    const runtime = {
      on: vi.fn(),
      exit: vi.fn(),
    };
    const { startWorker } = await import("@/worker");

    await expect(startWorker(runtime)).rejects.toBe(startupError);

    expect(queue.stop).toHaveBeenCalledOnce();
    expect(mocks.startConversationTitleRecovery).not.toHaveBeenCalled();
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
    mocks.startConversationTitleRecovery.mockReturnValue(vi.fn());
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
    const stopFileRecovery = vi.fn().mockRejectedValue(shutdownError);
    const stopTitleRecovery = vi.fn().mockResolvedValue(undefined);
    mocks.getQueue.mockResolvedValue(queue);
    mocks.startFileProcessingRecovery.mockReturnValue(stopFileRecovery);
    mocks.startConversationTitleRecovery.mockReturnValue(stopTitleRecovery);
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

    expect(stopTitleRecovery).toHaveBeenCalledOnce();
    expect(stopFileRecovery).toHaveBeenCalledOnce();
    expect(queue.stop).toHaveBeenCalledOnce();
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });
});
