import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  send: vi.fn(),
  createQueue: vi.fn(),
  work: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  on: vi.fn(),
}));

vi.mock("pg-boss", () => ({
  default: class MockPgBoss {
    constructor(opts: unknown) {
      mocks.constructor(opts);
    }

    send(...args: unknown[]) {
      return mocks.send(...args);
    }

    createQueue(...args: unknown[]) {
      return mocks.createQueue(...args);
    }

    work(...args: unknown[]) {
      return mocks.work(...args);
    }

    start() {
      return mocks.start();
    }

    stop() {
      return mocks.stop();
    }

    on(...args: unknown[]) {
      return mocks.on(...args);
    }
  },
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function loadQueue() {
  return import("@/lib/infra/queue");
}

describe("pg-boss queue adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://queue.test/db");
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.start.mockResolvedValue(undefined);
    mocks.createQueue.mockResolvedValue(undefined);
    mocks.send.mockResolvedValue("job-1");
    mocks.work.mockResolvedValue("worker-1");
    mocks.stop.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("并发冷启动只构造一个 adapter", async () => {
    const { getQueue } = await loadQueue();

    const [first, second] = await Promise.all([getQueue(), getQueue()]);

    expect(first).toBe(second);
    expect(mocks.constructor).toHaveBeenCalledOnce();
  });

  it("adapter 构造失败后可以重试", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { getQueue } = await loadQueue();

    await expect(getQueue()).rejects.toThrow("未配置 DATABASE_URL");
    vi.stubEnv("DATABASE_URL", "postgres://queue.test/retry");
    await expect(getQueue()).resolves.toBeDefined();

    expect(mocks.constructor).toHaveBeenCalledOnce();
  });

  it("PgBoss 构造器抛错后可以重试", async () => {
    mocks.constructor
      .mockImplementationOnce(() => {
        throw new Error("constructor failed");
      })
      .mockImplementationOnce(() => undefined);
    const { getQueue } = await loadQueue();

    await expect(getQueue()).rejects.toThrow("constructor failed");
    await expect(getQueue()).resolves.toBeDefined();

    expect(mocks.constructor).toHaveBeenCalledTimes(2);
  });

  it("send 按 start、createQueue、send 顺序执行", async () => {
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await expect(queue.send("memory-extract", { userId: "user-1" })).resolves.toBe("job-1");

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.createQueue).toHaveBeenCalledWith("memory-extract");
    expect(mocks.send).toHaveBeenCalledWith(
      "memory-extract",
      { userId: "user-1" },
      undefined,
    );
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createQueue.mock.invocationCallOrder[0],
    );
    expect(mocks.createQueue.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.send.mock.invocationCallOrder[0],
    );
  });

  it("并发 send 等待同一个 start 和同名 createQueue", async () => {
    const start = deferred<void>();
    mocks.start.mockReturnValue(start.promise);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    const first = queue.send("conversation-title", { id: 1 });
    const second = queue.send("conversation-title", { id: 2 });
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    expect(mocks.createQueue).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();

    start.resolve();
    await Promise.all([first, second]);

    expect(mocks.createQueue).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it("start 失败后下一次 send 可以重试", async () => {
    mocks.start
      .mockRejectedValueOnce(new Error("start failed"))
      .mockResolvedValueOnce(undefined);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await expect(queue.send("file-process", { id: 1 })).rejects.toThrow("start failed");
    await expect(queue.send("file-process", { id: 2 })).resolves.toBe("job-1");

    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.createQueue).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("createQueue 失败后下一次 send 可以重试", async () => {
    mocks.createQueue
      .mockRejectedValueOnce(new Error("create failed"))
      .mockResolvedValueOnce(undefined);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await expect(queue.send("file-process", { id: 1 })).rejects.toThrow("create failed");
    await expect(queue.send("file-process", { id: 2 })).resolves.toBe("job-1");

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.createQueue).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it.each([null, ""])("空 job id(%s)作为投递失败抛出", async (jobId) => {
    mocks.send.mockResolvedValue(jobId);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await expect(queue.send("memory-extract", { id: 1 })).rejects.toThrow(
      "pg-boss 未返回 job id: memory-extract",
    );
  });

  it("work 也在注册 handler 前启动并创建队列", async () => {
    const handler = vi.fn();
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await queue.work("memory-extract", handler);

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.createQueue).toHaveBeenCalledWith("memory-extract");
    expect(mocks.work).toHaveBeenCalledOnce();
    expect(mocks.createQueue.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.work.mock.invocationCallOrder[0],
    );
  });

  it("work 将 handler 拒绝原样交给 pg-boss 并停止当前批次", async () => {
    let pgBossHandler!: (jobs: { data: unknown }[]) => Promise<void>;
    mocks.work.mockImplementation(async (_name, handler) => {
      pgBossHandler = handler as typeof pgBossHandler;
      return "worker-1";
    });
    const taskError = new Error("task failed");
    const handler = vi.fn().mockRejectedValueOnce(taskError);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();
    await queue.work("conversation-title", handler);

    await expect(pgBossHandler([
      { data: { id: 1 } },
      { data: { id: 2 } },
    ])).rejects.toBe(taskError);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ id: 1 });
  });

  it("queueAvailable 等待真实 start", async () => {
    const start = deferred<void>();
    mocks.start.mockReturnValue(start.promise);
    const { queueAvailable } = await loadQueue();
    let settled = false;

    const available = queueAvailable().finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    expect(settled).toBe(false);

    start.resolve();
    await expect(available).resolves.toBe(true);
  });

  it("stop 后允许重新 start", async () => {
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await queue.start();
    await queue.stop();
    await queue.start();

    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it("stop 期间的 send 等待停止完成后重新启动", async () => {
    const stop = deferred<void>();
    mocks.stop.mockReturnValue(stop.promise);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();
    await queue.start();

    const stopping = queue.stop();
    await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledOnce());
    const sending = queue.send("memory-extract", { id: 1 });
    await Promise.resolve();
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();

    stop.resolve();
    await stopping;
    await expect(sending).resolves.toBe("job-1");
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("stop 等待已经进入 createQueue 的 send 完成", async () => {
    const create = deferred<void>();
    mocks.createQueue.mockReturnValue(create.promise);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    const sending = queue.send("file-process", { id: 1 });
    await vi.waitFor(() => expect(mocks.createQueue).toHaveBeenCalledOnce());
    const stopping = queue.stop();
    await Promise.resolve();
    expect(mocks.stop).not.toHaveBeenCalled();

    create.resolve();
    await expect(sending).resolves.toBe("job-1");
    await stopping;
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.send.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.stop.mock.invocationCallOrder[0],
    );
  });
});
