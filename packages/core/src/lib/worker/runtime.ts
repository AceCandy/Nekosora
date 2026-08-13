import type { QueueAdapter } from "@/lib/infra/queue";
import type {
  JobOutcome,
  QueueDefinition,
} from "@/lib/jobs/catalog";

export interface RecoveryDefinition {
  readonly intervalMs: number;
  readonly run: () => Promise<void>;
  readonly failureMessage: string;
}

export interface WorkerDefinition {
  readonly job: QueueDefinition<object>;
  readonly handle: (payload: object) => Promise<JobOutcome>;
  readonly recovery: RecoveryDefinition;
}

export interface MaintenanceDefinition {
  readonly name: string;
  readonly recovery: RecoveryDefinition;
}

export type RuntimeDefinition = WorkerDefinition | MaintenanceDefinition;

export interface WorkerTimerHandle {
  unref(): void;
}

export interface WorkerTimers {
  scheduleImmediate(callback: () => void): void;
  setInterval(callback: () => void, intervalMs: number): WorkerTimerHandle;
  clearInterval(timer: WorkerTimerHandle): void;
}

export interface WorkerLogger {
  log(message: string): void;
  error(message: string): void;
}

export interface WorkerProcess {
  on(
    signal: "SIGINT" | "SIGTERM",
    handler: () => void | Promise<void>,
  ): unknown;
  exit(code: number): unknown;
}

export interface RecoveryController {
  stop(): Promise<void>;
}

export interface WorkerRuntimeController {
  start(): Promise<void>;
  shutdown(): Promise<void>;
}

export type WorkerRuntimeState = "starting" | "ready" | "stopping" | "stopped";

export interface CreateWorkerRuntimeOptions {
  readonly queue: Pick<QueueAdapter, "start" | "work" | "stop">;
  readonly definitions: readonly RuntimeDefinition[];
  readonly process: WorkerProcess;
  readonly onStateChange?: (state: WorkerRuntimeState) => void;
  readonly closeResources?: () => Promise<void>;
  readonly logger?: WorkerLogger;
  readonly timers?: WorkerTimers;
  readonly schedulerFactory?: (
    definition: RuntimeDefinition,
  ) => RecoveryController;
}

const DEFAULT_TIMERS: WorkerTimers = {
  scheduleImmediate(callback) {
    globalThis.queueMicrotask(callback);
  },
  setInterval(callback, intervalMs) {
    return globalThis.setInterval(callback, intervalMs) as unknown as WorkerTimerHandle;
  },
  clearInterval(timer) {
    globalThis.clearInterval(
      timer as unknown as ReturnType<typeof globalThis.setInterval>,
    );
  },
};

/** 创建立即执行、周期单飞且可等待停止的恢复调度器。 */
export function startRecoveryScheduler(
  recovery: RecoveryDefinition,
  timers: WorkerTimers = DEFAULT_TIMERS,
  logger: WorkerLogger = console,
): RecoveryController {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;

  const run = () => {
    if (stopped || inFlight) return;
    const pending = Promise.resolve()
      .then(recovery.run)
      .catch(() => {
        logger.error(recovery.failureMessage);
      });
    inFlight = pending;
    const clear = () => {
      if (inFlight === pending) inFlight = null;
    };
    void pending.then(clear, clear);
  };

  const timer = timers.setInterval(run, recovery.intervalMs);
  try {
    timer.unref();
    timers.scheduleImmediate(run);
  } catch (error) {
    timers.clearInterval(timer);
    throw error;
  }

  return {
    stop() {
      if (stopPromise) return stopPromise;
      stopped = true;
      timers.clearInterval(timer);
      stopPromise = Promise.resolve(inFlight).then(() => undefined);
      return stopPromise;
    },
  };
}

/** 统一拥有 worker 注册、恢复调度、回滚与 signal shutdown。 */
export function createWorkerRuntime(
  options: CreateWorkerRuntimeOptions,
): WorkerRuntimeController {
  const {
    queue,
    definitions,
    process: runtimeProcess,
    logger = console,
    timers = DEFAULT_TIMERS,
  } = options;
  const schedulerFactory = options.schedulerFactory
    ?? ((definition: RuntimeDefinition) => (
      startRecoveryScheduler(definition.recovery, timers, logger)
    ));
  const schedulers: Array<{
    definition: RuntimeDefinition;
    controller: RecoveryController;
  }> = [];
  let state: "idle" | "starting" | "running" | "stopping" | "stopped" = "idle";
  let startPromise: Promise<void> | null = null;
  let cleanupPromise: Promise<boolean> | null = null;
  let shutdownPromise: Promise<void> | null = null;

  function setState(nextState: typeof state): void {
    state = nextState;
    const publicState = nextState === "running" ? "ready" : nextState;
    if (publicState !== "idle") options.onStateChange?.(publicState);
  }

  function cleanup(): Promise<boolean> {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      let failed = false;
      for (let index = schedulers.length - 1; index >= 0; index -= 1) {
        const scheduler = schedulers[index]!;
        try {
          await scheduler.controller.stop();
        } catch {
          failed = true;
          logger.error(`[worker] recovery stop failed: ${definitionName(scheduler.definition)}`);
        }
      }
      try {
        await queue.stop();
      } catch {
        failed = true;
        logger.error("[worker] queue stop failed");
      }
      try {
        await options.closeResources?.();
      } catch {
        failed = true;
        logger.error("[worker] resource close failed");
      }
      return failed;
    })();
    return cleanupPromise;
  }

  function shutdown(): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    setState("stopping");
    shutdownPromise = (async () => {
      logger.log("[worker] stopping");
      if (startPromise) {
        try {
          await startPromise;
        } catch {
          // 启动流程负责回滚；shutdown 复用其清理状态。
        }
      }
      const failed = await cleanup();
      setState("stopped");
      runtimeProcess.exit(failed ? 1 : 0);
    })();
    return shutdownPromise;
  }

  function start(): Promise<void> {
    if (state === "stopping" || state === "stopped") {
      return Promise.reject(new Error("worker runtime 已停止"));
    }
    if (startPromise) return startPromise;
    setState("starting");
    startPromise = (async () => {
      try {
        await queue.start();
        if (state !== "starting") return;
        for (const definition of definitions) {
          if (!("job" in definition)) continue;
          await queue.work(definition.job, async (payload) => {
            try {
              const outcome = await definition.handle(payload);
              logger.log(`[worker] ${definition.job.name}: ${outcome}`);
              return outcome;
            } catch (error) {
              logger.error(`[worker] ${definition.job.name}: retryable_failure`);
              throw error;
            }
          });
          if (state !== "starting") return;
        }
        for (const definition of definitions) {
          schedulers.push({
            definition,
            controller: schedulerFactory(definition),
          });
        }
        runtimeProcess.on("SIGINT", shutdown);
        runtimeProcess.on("SIGTERM", shutdown);
        setState("running");
        logger.log("[worker] ready");
      } catch (error) {
        setState("stopping");
        await cleanup();
        setState("stopped");
        throw error;
      }
    })();
    return startPromise;
  }

  return { start, shutdown };
}

function definitionName(definition: RuntimeDefinition): string {
  return "job" in definition ? definition.job.name : definition.name;
}
