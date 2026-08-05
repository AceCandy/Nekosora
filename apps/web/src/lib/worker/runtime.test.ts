import { describe, expect, it, vi } from "vitest";
import type { QueueDefinition } from "@/lib/jobs/catalog";
import {
  createWorkerRuntime,
  startRecoveryScheduler,
  type WorkerDefinition,
  type WorkerTimers,
} from "./runtime";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function definition(name: string): WorkerDefinition & {
  handle: ReturnType<typeof vi.fn>;
  recovery: WorkerDefinition["recovery"] & { run: ReturnType<typeof vi.fn> };
} {
  return {
    job: {
      name,
      policy: {
        retryLimit: 2,
        retryDelay: 0,
        retryBackoff: false,
        expireInSeconds: 900,
      },
      retryMessage: `${name} failed`,
    } as QueueDefinition<object>,
    handle: vi.fn().mockResolvedValue("completed"),
    recovery: {
      intervalMs: 60_000,
      run: vi.fn().mockResolvedValue(undefined),
      failureMessage: `[${name}-recovery] scan failed`,
    },
  };
}

function timerHarness() {
  const immediate: Array<() => void> = [];
  const intervals: Array<() => void> = [];
  const handle = { unref: vi.fn() };
  const timers: WorkerTimers = {
    scheduleImmediate: vi.fn((callback) => {
      immediate.push(callback);
    }),
    setInterval: vi.fn((callback) => {
      intervals.push(callback);
      return handle;
    }),
    clearInterval: vi.fn(),
  };
  return { timers, immediate, intervals, handle };
}

describe("worker recovery scheduler", () => {
  it("立即执行、周期单飞、unref，stop 等待在途 round", async () => {
    const item = definition("file-process");
    const round = deferred<void>();
    item.recovery.run.mockReturnValue(round.promise);
    const harness = timerHarness();
    const logger = { log: vi.fn(), error: vi.fn() };

    const scheduler = startRecoveryScheduler(
      item.recovery,
      harness.timers,
      logger,
    );

    expect(harness.timers.setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      60_000,
    );
    expect(harness.handle.unref).toHaveBeenCalledOnce();
    expect(item.recovery.run).not.toHaveBeenCalled();

    harness.immediate[0]!();
    await vi.waitFor(() => expect(item.recovery.run).toHaveBeenCalledOnce());
    harness.intervals[0]!();
    harness.intervals[0]!();
    expect(item.recovery.run).toHaveBeenCalledOnce();

    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(harness.timers.clearInterval).toHaveBeenCalledOnce();

    round.resolve();
    await stopping;
    harness.intervals[0]!();
    expect(item.recovery.run).toHaveBeenCalledOnce();
  });

  it("round 失败只记录稳定消息且下个周期继续", async () => {
    const item = definition("memory-extract");
    item.recovery.run
      .mockRejectedValueOnce(new Error("postgresql://secret payload-id"))
      .mockResolvedValueOnce(undefined);
    const harness = timerHarness();
    const logger = { log: vi.fn(), error: vi.fn() };
    const scheduler = startRecoveryScheduler(
      item.recovery,
      harness.timers,
      logger,
    );

    harness.immediate[0]!();
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledWith(
      "[memory-extract-recovery] scan failed",
    ));
    harness.intervals[0]!();
    await vi.waitFor(() => expect(item.recovery.run).toHaveBeenCalledTimes(2));

    expect(logger.error.mock.calls.flat().join(" ")).not.toContain("payload-id");
    await scheduler.stop();
  });
});

describe("worker runtime", () => {
  it("按定义顺序注册，逆序停止 recovery，重复 signal 只清理并退出一次", async () => {
    const calls: string[] = [];
    const definitions = [
      definition("file-process"),
      definition("memory-extract"),
      definition("conversation-title"),
    ];
    const queue = {
      start: vi.fn(async () => { calls.push("queue.start"); }),
      work: vi.fn(async (job: QueueDefinition<object>) => {
        calls.push(`queue.work:${job.name}`);
      }),
      stop: vi.fn(async () => { calls.push("queue.stop"); }),
    };
    const titleStop = deferred<void>();
    const schedulerFactory = vi.fn((item: WorkerDefinition) => {
      calls.push(`recovery.start:${item.job.name}`);
      return {
        stop: vi.fn(async () => {
          calls.push(`recovery.stop:${item.job.name}`);
          if (item.job.name === "conversation-title") await titleStop.promise;
        }),
      };
    });
    const signalHandlers = new Map<string, () => Promise<void>>();
    const runtimeProcess = {
      on: vi.fn((signal: string, handler: () => Promise<void>) => {
        signalHandlers.set(signal, handler);
      }),
      exit: vi.fn((code: number) => { calls.push(`exit:${code}`); }),
    };
    const runtime = createWorkerRuntime({
      queue,
      definitions,
      process: runtimeProcess,
      schedulerFactory,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    const firstStart = runtime.start();
    const secondStart = runtime.start();
    expect(firstStart).toBe(secondStart);
    await firstStart;
    expect(calls).toEqual([
      "queue.start",
      "queue.work:file-process",
      "queue.work:memory-extract",
      "queue.work:conversation-title",
      "recovery.start:file-process",
      "recovery.start:memory-extract",
      "recovery.start:conversation-title",
    ]);

    const firstShutdown = signalHandlers.get("SIGINT")!();
    const secondShutdown = signalHandlers.get("SIGTERM")!();
    const thirdShutdown = signalHandlers.get("SIGINT")!();
    expect(firstShutdown).toBe(secondShutdown);
    expect(firstShutdown).toBe(thirdShutdown);
    await Promise.resolve();
    expect(calls.at(-1)).toBe("recovery.stop:conversation-title");

    titleStop.resolve();
    await firstShutdown;
    expect(calls.slice(-5)).toEqual([
      "recovery.stop:conversation-title",
      "recovery.stop:memory-extract",
      "recovery.stop:file-process",
      "queue.stop",
      "exit:0",
    ]);
    expect(queue.stop).toHaveBeenCalledOnce();
    expect(runtimeProcess.exit).toHaveBeenCalledOnce();
    await expect(runtime.start()).rejects.toThrow("worker runtime 已停止");
  });

  it("启动期间 shutdown 等待启动收敛且不再注册后续资源", async () => {
    const queueStart = deferred<void>();
    const queue = {
      start: vi.fn(() => queueStart.promise),
      work: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const schedulerFactory = vi.fn();
    const runtimeProcess = { on: vi.fn(), exit: vi.fn() };
    const logger = { log: vi.fn(), error: vi.fn() };
    const runtime = createWorkerRuntime({
      queue,
      definitions: [definition("file-process")],
      process: runtimeProcess,
      schedulerFactory,
      logger,
    });

    const starting = runtime.start();
    const stopping = runtime.shutdown();
    expect(queue.stop).not.toHaveBeenCalled();

    queueStart.resolve();
    await Promise.all([starting, stopping]);

    expect(queue.work).not.toHaveBeenCalled();
    expect(schedulerFactory).not.toHaveBeenCalled();
    expect(runtimeProcess.on).not.toHaveBeenCalled();
    expect(queue.stop).toHaveBeenCalledOnce();
    expect(runtimeProcess.exit).toHaveBeenCalledWith(0);
    expect(logger.log).not.toHaveBeenCalledWith("[worker] ready");
    await expect(runtime.start()).rejects.toThrow("worker runtime 已停止");
  });

  it("handler 日志只包含 job 名和 outcome，失败继续 reject", async () => {
    const item = definition("conversation-title");
    const rawError = new Error(
      "user-text payload-id-1 authorization=header-secret "
      + "credential=credential-secret https://provider.example/private",
      { cause: new Error("cause-secret") },
    );
    rawError.stack = "stack-secret";
    item.handle
      .mockResolvedValueOnce("completed")
      .mockRejectedValueOnce(rawError);
    let registeredHandler!: (payload: object) => Promise<unknown>;
    const queue = {
      start: vi.fn().mockResolvedValue(undefined),
      work: vi.fn(async (
        _job: QueueDefinition<object>,
        handler: (payload: object) => Promise<unknown>,
      ) => { registeredHandler = handler; }),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const logger = { log: vi.fn(), error: vi.fn() };
    const runtime = createWorkerRuntime({
      queue,
      definitions: [item],
      process: { on: vi.fn(), exit: vi.fn() },
      schedulerFactory: () => ({ stop: vi.fn().mockResolvedValue(undefined) }),
      logger,
    });
    await runtime.start();

    await expect(registeredHandler({ id: "payload-id-1" })).resolves.toBe("completed");
    await expect(registeredHandler({ id: "payload-id-1" })).rejects.toBe(rawError);

    expect(logger.log).toHaveBeenCalledWith("[worker] conversation-title: completed");
    expect(logger.error).toHaveBeenCalledWith(
      "[worker] conversation-title: retryable_failure",
    );
    const logged = [...logger.log.mock.calls, ...logger.error.mock.calls].flat().join(" ");
    for (const secret of [
      "user-text",
      "payload-id-1",
      "header-secret",
      "credential-secret",
      "provider.example",
      "cause-secret",
      "stack-secret",
    ]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("queue start 失败时尝试关闭队列并保留原错误", async () => {
    const startupError = new Error("start failed");
    const queue = {
      start: vi.fn().mockRejectedValue(startupError),
      work: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const runtimeProcess = { on: vi.fn(), exit: vi.fn() };
    const schedulerFactory = vi.fn();
    const runtime = createWorkerRuntime({
      queue,
      definitions: [definition("file-process")],
      process: runtimeProcess,
      schedulerFactory,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    await expect(runtime.start()).rejects.toBe(startupError);

    expect(queue.stop).toHaveBeenCalledOnce();
    expect(queue.work).not.toHaveBeenCalled();
    expect(schedulerFactory).not.toHaveBeenCalled();
    expect(runtimeProcess.exit).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])(
    "第 %i 个 handler 注册失败时不启动 recovery 并保留原错误",
    async (failureIndex) => {
      const startupError = new Error(`registration-${failureIndex}`);
      const definitions = [
        definition("file-process"),
        definition("memory-extract"),
        definition("conversation-title"),
      ];
      let index = 0;
      const queue = {
        start: vi.fn().mockResolvedValue(undefined),
        work: vi.fn(async () => {
          if (index++ === failureIndex) throw startupError;
        }),
        stop: vi.fn().mockResolvedValue(undefined),
      };
      const schedulerFactory = vi.fn();
      const runtime = createWorkerRuntime({
        queue,
        definitions,
        process: { on: vi.fn(), exit: vi.fn() },
        schedulerFactory,
        logger: { log: vi.fn(), error: vi.fn() },
      });

      await expect(runtime.start()).rejects.toBe(startupError);

      expect(queue.work).toHaveBeenCalledTimes(failureIndex + 1);
      expect(schedulerFactory).not.toHaveBeenCalled();
      expect(queue.stop).toHaveBeenCalledOnce();
    },
  );

  it.each([0, 1, 2])(
    "第 %i 个 recovery 构造失败时逆序停止已启动项并保留原错误",
    async (failureIndex) => {
      const startupError = new Error(`scheduler-${failureIndex}`);
      const definitions = [
        definition("file-process"),
        definition("memory-extract"),
        definition("conversation-title"),
      ];
      const stopped: string[] = [];
      let index = 0;
      const schedulerFactory = vi.fn((item: WorkerDefinition) => {
        if (index++ === failureIndex) throw startupError;
        return {
          stop: vi.fn(async () => { stopped.push(item.job.name); }),
        };
      });
      const queue = {
        start: vi.fn().mockResolvedValue(undefined),
        work: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      };
      const runtime = createWorkerRuntime({
        queue,
        definitions,
        process: { on: vi.fn(), exit: vi.fn() },
        schedulerFactory,
        logger: { log: vi.fn(), error: vi.fn() },
      });

      await expect(runtime.start()).rejects.toBe(startupError);

      expect(stopped).toEqual(
        definitions.slice(0, failureIndex).map((item) => item.job.name).reverse(),
      );
      expect(queue.stop).toHaveBeenCalledOnce();
    },
  );

  it("startup cleanup 失败不覆盖根因且继续清理", async () => {
    const startupError = new Error("scheduler failed");
    const definitions = [
      definition("file-process"),
      definition("memory-extract"),
      definition("conversation-title"),
    ];
    const firstStop = vi.fn().mockResolvedValue(undefined);
    const secondStop = vi.fn().mockRejectedValue(new Error("stop payload-id"));
    let index = 0;
    const schedulerFactory = vi.fn(() => {
      if (index === 2) throw startupError;
      return { stop: index++ === 0 ? firstStop : secondStop };
    });
    const queue = {
      start: vi.fn().mockResolvedValue(undefined),
      work: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockRejectedValue(new Error("postgresql://secret")),
    };
    const logger = { log: vi.fn(), error: vi.fn() };
    const runtime = createWorkerRuntime({
      queue,
      definitions,
      process: { on: vi.fn(), exit: vi.fn() },
      schedulerFactory,
      logger,
    });

    await expect(runtime.start()).rejects.toBe(startupError);

    expect(secondStop).toHaveBeenCalledOnce();
    expect(firstStop).toHaveBeenCalledOnce();
    expect(queue.stop).toHaveBeenCalledOnce();
    const logged = logger.error.mock.calls.flat().join(" ");
    expect(logged).not.toContain("payload-id");
    expect(logged).not.toContain("postgresql://");
  });

  it("shutdown 清理失败时继续后续项并只退出一次失败码", async () => {
    const definitions = [
      definition("file-process"),
      definition("memory-extract"),
      definition("conversation-title"),
    ];
    const titleStop = deferred<void>();
    const stops = definitions.map((item) => vi.fn().mockImplementation(async () => {
      if (item.job.name === "conversation-title") await titleStop.promise;
      if (item.job.name === "memory-extract") throw new Error("payload-id");
    }));
    let index = 0;
    const queue = {
      start: vi.fn().mockResolvedValue(undefined),
      work: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockRejectedValue(new Error("postgresql://secret")),
    };
    const signalHandlers = new Map<string, () => Promise<void>>();
    const runtimeProcess = {
      on: vi.fn((signal: string, handler: () => Promise<void>) => {
        signalHandlers.set(signal, handler);
      }),
      exit: vi.fn(),
    };
    const logger = { log: vi.fn(), error: vi.fn() };
    const runtime = createWorkerRuntime({
      queue,
      definitions,
      process: runtimeProcess,
      schedulerFactory: () => ({ stop: stops[index++]! }),
      logger,
    });
    await runtime.start();

    const firstShutdown = signalHandlers.get("SIGTERM")!();
    const secondShutdown = signalHandlers.get("SIGINT")!();
    expect(firstShutdown).toBe(secondShutdown);
    titleStop.resolve();
    await firstShutdown;

    expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
    expect(queue.stop).toHaveBeenCalledOnce();
    expect(runtimeProcess.exit).toHaveBeenCalledOnce();
    expect(runtimeProcess.exit).toHaveBeenCalledWith(1);
    const logged = logger.error.mock.calls.flat().join(" ");
    expect(logged).not.toContain("payload-id");
    expect(logged).not.toContain("postgresql://");
  });
});
