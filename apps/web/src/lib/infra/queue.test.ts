import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONVERSATION_TITLE_QUEUE,
  FILE_PROCESS_QUEUE,
  MEMORY_EXTRACTION_QUEUE,
} from "@/lib/jobs/catalog";

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

    stop(...args: unknown[]) {
      return mocks.stop(...args);
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
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("并发获取只返回一个 adapter 且不提前构造 driver", async () => {
    const { getQueue } = await loadQueue();

    const [first, second] = await Promise.all([getQueue(), getQueue()]);

    expect(first).toBe(second);
    expect(mocks.constructor).not.toHaveBeenCalled();
  });

  it("adapter 构造失败后可以重试", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { getQueue } = await loadQueue();

    await expect(getQueue()).rejects.toThrow("未配置 DATABASE_URL");
    vi.stubEnv("DATABASE_URL", "postgres://queue.test/retry");
    const queue = await getQueue();
    await queue.start();

    expect(mocks.constructor).toHaveBeenCalledOnce();
  });

  it("PgBoss 构造器抛错后可以重试", async () => {
    mocks.constructor
      .mockImplementationOnce(() => {
        throw new Error("constructor failed");
      })
      .mockImplementationOnce(() => undefined);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await expect(queue.start()).rejects.toThrow("constructor failed");
    await expect(queue.start()).resolves.toBeUndefined();

    expect(mocks.constructor).toHaveBeenCalledTimes(2);
  });

  it("send 按 start、createQueue、send 顺序执行", async () => {
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await expect(queue.send(MEMORY_EXTRACTION_QUEUE, { id: "job-1" }))
      .resolves.toBe("job-1");

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.createQueue).toHaveBeenCalledWith(
      "memory-extract",
      MEMORY_EXTRACTION_QUEUE.policy,
    );
    expect(mocks.send).toHaveBeenCalledWith(
      "memory-extract",
      { id: "job-1" },
      MEMORY_EXTRACTION_QUEUE.policy,
    );
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createQueue.mock.invocationCallOrder[0],
    );
    expect(mocks.createQueue.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.send.mock.invocationCallOrder[0],
    );
  });

  it("向 pg-boss 传递可变 policy 副本而不暴露 frozen catalog", async () => {
    mocks.createQueue.mockImplementation(async (_name, options) => {
      expect(Object.isFrozen(options)).toBe(false);
      Object.assign(options as object, { policy: "standard" });
    });
    mocks.send.mockImplementation(async (_name, _data, options) => {
      expect(Object.isFrozen(options)).toBe(false);
      Object.assign(options as object, { priority: 1 });
      return "job-1";
    });
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await expect(queue.send(MEMORY_EXTRACTION_QUEUE, { id: "job-1" }))
      .resolves.toBe("job-1");

    expect(MEMORY_EXTRACTION_QUEUE.policy).toEqual({
      retryLimit: 2,
      retryDelay: 0,
      retryBackoff: false,
      expireInSeconds: 900,
    });
  });

  it("并发 send 等待同一个 start 和同名 createQueue", async () => {
    const start = deferred<void>();
    mocks.start.mockReturnValue(start.promise);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    const first = queue.send(CONVERSATION_TITLE_QUEUE, { id: "job-1" });
    const second = queue.send(CONVERSATION_TITLE_QUEUE, { id: "job-2" });
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    expect(mocks.createQueue).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();

    start.resolve();
    await Promise.all([first, second]);

    expect(mocks.createQueue).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it("不同名 queue 并发创建且共享同一 generation start", async () => {
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await Promise.all([
      queue.send(MEMORY_EXTRACTION_QUEUE, { id: "memory-1" }),
      queue.send(CONVERSATION_TITLE_QUEUE, { id: "title-1" }),
    ]);

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.createQueue).toHaveBeenCalledTimes(2);
    expect(mocks.createQueue).toHaveBeenCalledWith(
      "memory-extract",
      MEMORY_EXTRACTION_QUEUE.policy,
    );
    expect(mocks.createQueue).toHaveBeenCalledWith(
      "conversation-title",
      CONVERSATION_TITLE_QUEUE.policy,
    );
  });

  it("start 失败后下一次 send 可以重试", async () => {
    mocks.start
      .mockRejectedValueOnce(new Error("start failed"))
      .mockResolvedValueOnce(undefined);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await expect(queue.send(FILE_PROCESS_QUEUE, { fileId: "file-1" }))
      .rejects.toThrow("start failed");
    await expect(queue.send(FILE_PROCESS_QUEUE, { fileId: "file-2" }))
      .resolves.toBe("job-1");

    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.constructor).toHaveBeenCalledTimes(2);
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.createQueue).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("createQueue 失败后下一次 send 可以重试", async () => {
    mocks.createQueue
      .mockRejectedValueOnce(new Error("create failed"))
      .mockResolvedValueOnce(undefined);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await expect(queue.send(FILE_PROCESS_QUEUE, { fileId: "file-1" }))
      .rejects.toThrow("create failed");
    await expect(queue.send(FILE_PROCESS_QUEUE, { fileId: "file-2" }))
      .resolves.toBe("job-1");

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.createQueue).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it.each([null, ""])("空 job id(%s)作为投递失败抛出", async (jobId) => {
    mocks.send.mockResolvedValue(jobId);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await expect(queue.send(MEMORY_EXTRACTION_QUEUE, { id: "job-1" })).rejects.toThrow(
      "pg-boss 未返回 job id: memory-extract",
    );
  });

  it("work 也在注册 handler 前启动并创建队列", async () => {
    const handler = vi.fn();
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await queue.work(MEMORY_EXTRACTION_QUEUE, handler);

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.createQueue).toHaveBeenCalledWith(
      "memory-extract",
      MEMORY_EXTRACTION_QUEUE.policy,
    );
    expect(mocks.work).toHaveBeenCalledOnce();
    expect(mocks.createQueue.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.work.mock.invocationCallOrder[0],
    );
  });

  it("work 将 handler 拒绝收敛为 catalog 安全错误并停止当前批次", async () => {
    let pgBossHandler!: (jobs: { data: unknown }[]) => Promise<void>;
    mocks.work.mockImplementation(async (_name, handler) => {
      pgBossHandler = handler as typeof pgBossHandler;
      return "worker-1";
    });
    const taskError = new Error(
      "user-text payload-id authorization=header-secret credential=credential-secret "
      + "https://provider.example/private",
      { cause: new Error("cause-secret") },
    );
    taskError.stack = "stack-secret";
    const handler = vi.fn().mockRejectedValueOnce(taskError);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();
    await queue.work(CONVERSATION_TITLE_QUEUE, handler);

    const rejection = await pgBossHandler([
      { data: { id: 1 } },
      { data: { id: 2 } },
    ]).catch((error) => error as Error);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ id: 1 });
    expect(rejection).not.toBe(taskError);
    expect(rejection).toMatchObject({ message: "会话标题生成失败" });
    expect(rejection).not.toHaveProperty("cause");
    expect(rejection.message).toBe(CONVERSATION_TITLE_QUEUE.retryMessage);
    const serialized = `${rejection.message}\n${rejection.stack ?? ""}`;
    for (const secret of [
      "user-text",
      "payload-id",
      "header-secret",
      "credential-secret",
      "provider.example",
      "cause-secret",
      "stack-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("work 仅把 completed 和 noop 作为成功 outcome", async () => {
    let pgBossHandler!: (jobs: { data: unknown }[]) => Promise<void>;
    mocks.work.mockImplementation(async (_name, handler) => {
      pgBossHandler = handler as typeof pgBossHandler;
      return "worker-1";
    });
    const handler = vi.fn()
      .mockResolvedValueOnce("completed")
      .mockResolvedValueOnce("noop");
    const { getQueue } = await loadQueue();
    const queue = await getQueue();
    await queue.work(CONVERSATION_TITLE_QUEUE, handler);

    await expect(pgBossHandler([
      { data: { id: "job-1" } },
      { data: { id: "job-2" } },
    ])).resolves.toBeUndefined();

    expect(handler).toHaveBeenCalledTimes(2);
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

  it("pg-boss error event 只记录固定安全消息", async () => {
    let errorListener!: (error: unknown) => void;
    mocks.on.mockImplementation((event, listener) => {
      if (event === "error") errorListener = listener as typeof errorListener;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();
    await queue.start();

    errorListener(new Error(
      "postgresql://user:password@db/private?token=secret payload-id-1",
    ));

    expect(errorSpy).toHaveBeenCalledWith("[queue] pg-boss error");
    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("postgresql://");
    expect(logged).not.toContain("payload-id-1");
  });

  it("stop 后允许重新 start", async () => {
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await queue.start();
    await queue.stop();
    await queue.start();

    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.constructor).toHaveBeenCalledTimes(2);
    expect(mocks.stop).toHaveBeenCalledWith({
      close: true,
      graceful: true,
      wait: true,
      timeout: 30_000,
    });
  });

  it("并发 stop 复用同一 Promise", async () => {
    const stop = deferred<void>();
    mocks.stop.mockReturnValue(stop.promise);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();
    await queue.start();

    const first = queue.stop();
    const second = queue.stop();

    expect(first).toBe(second);
    await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledOnce());
    stop.resolve();
    await first;
  });

  it("stop 等待 pending start，期间 start 在新 generation 上执行", async () => {
    const firstStart = deferred<void>();
    mocks.start
      .mockReturnValueOnce(firstStart.promise)
      .mockResolvedValueOnce(undefined);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    const starting = queue.start();
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    const stopping = queue.stop();
    const restarting = queue.start();
    expect(mocks.stop).not.toHaveBeenCalled();

    firstStart.resolve();
    await starting;
    await stopping;
    await restarting;

    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.constructor).toHaveBeenCalledTimes(2);
  });

  it("stop 失败后丢弃旧 generation，下一次 start 构造新实例", async () => {
    const stopError = new Error("stop failed");
    mocks.stop
      .mockRejectedValueOnce(stopError)
      .mockResolvedValueOnce(undefined);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();
    await queue.start();

    await expect(queue.stop()).rejects.toBe(stopError);
    await expect(queue.start()).resolves.toBeUndefined();

    expect(mocks.constructor).toHaveBeenCalledTimes(2);
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it("新 generation 会重新确认同名 queue", async () => {
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    await queue.send(MEMORY_EXTRACTION_QUEUE, { id: "job-1" });
    await queue.stop();
    await queue.send(MEMORY_EXTRACTION_QUEUE, { id: "job-2" });

    expect(mocks.createQueue).toHaveBeenCalledTimes(2);
  });

  it("boss.stop 返回时仍有 active handler 则关闭失败", async () => {
    let pgBossHandler!: (jobs: { data: unknown }[]) => Promise<void>;
    mocks.work.mockImplementation(async (_name, handler) => {
      pgBossHandler = handler as typeof pgBossHandler;
      return "worker-1";
    });
    const handlerDone = deferred<"completed">();
    const handler = vi.fn(() => handlerDone.promise);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();
    await queue.work(MEMORY_EXTRACTION_QUEUE, handler);
    const handling = pgBossHandler([{ data: { id: "job-1" } }]);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());

    await expect(queue.stop()).rejects.toThrow("队列任务未在关闭期限内完成");

    handlerDone.resolve("completed");
    await handling;
  });

  it("boss.stop 等待 active handler 完成时正常关闭", async () => {
    let pgBossHandler!: (jobs: { data: unknown }[]) => Promise<void>;
    mocks.work.mockImplementation(async (_name, handler) => {
      pgBossHandler = handler as typeof pgBossHandler;
      return "worker-1";
    });
    const handlerDone = deferred<"completed">();
    const handler = vi.fn(() => handlerDone.promise);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();
    await queue.work(MEMORY_EXTRACTION_QUEUE, handler);
    const handling = pgBossHandler([{ data: { id: "job-1" } }]);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    mocks.stop.mockImplementationOnce(async () => {
      handlerDone.resolve("completed");
      await handling;
    });

    await expect(queue.stop()).resolves.toBeUndefined();
  });

  it("即使 handler 恰好完成，monotonic deadline 到期仍关闭失败", async () => {
    let pgBossHandler!: (jobs: { data: unknown }[]) => Promise<void>;
    mocks.work.mockImplementation(async (_name, handler) => {
      pgBossHandler = handler as typeof pgBossHandler;
      return "worker-1";
    });
    const handlerDone = deferred<"completed">();
    const handler = vi.fn(() => handlerDone.promise);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();
    await queue.work(MEMORY_EXTRACTION_QUEUE, handler);
    const handling = pgBossHandler([{ data: { id: "job-1" } }]);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    const now = vi.spyOn(globalThis.performance, "now");
    now.mockReturnValueOnce(100).mockReturnValueOnce(30_100);
    mocks.stop.mockImplementationOnce(async () => {
      handlerDone.resolve("completed");
      await handling;
    });

    await expect(queue.stop()).rejects.toThrow("队列任务未在关闭期限内完成");
  });

  it("stop 期间的 send 等待停止完成后重新启动", async () => {
    const stop = deferred<void>();
    mocks.stop.mockReturnValue(stop.promise);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();
    await queue.start();

    const stopping = queue.stop();
    await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledOnce());
    const sending = queue.send(MEMORY_EXTRACTION_QUEUE, { id: "job-1" });
    await Promise.resolve();
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();

    stop.resolve();
    await stopping;
    await expect(sending).resolves.toBe("job-1");
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("stop 期间的新 work 等待下一代启动后注册", async () => {
    const stop = deferred<void>();
    mocks.stop.mockReturnValue(stop.promise);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();
    await queue.start();

    const stopping = queue.stop();
    await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledOnce());
    const registering = queue.work(MEMORY_EXTRACTION_QUEUE, vi.fn());
    await Promise.resolve();
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.work).not.toHaveBeenCalled();

    stop.resolve();
    await stopping;
    await registering;
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.constructor).toHaveBeenCalledTimes(2);
    expect(mocks.work).toHaveBeenCalledOnce();
  });

  it("stop 等待已经进入 createQueue 的 send 完成", async () => {
    const create = deferred<void>();
    mocks.createQueue.mockReturnValue(create.promise);
    const { getQueue } = await loadQueue();
    const queue = await getQueue();

    const sending = queue.send(FILE_PROCESS_QUEUE, { fileId: "file-1" });
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
