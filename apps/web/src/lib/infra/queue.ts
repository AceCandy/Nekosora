/**
 * 任务队列 —— pg-boss(PostgreSQL)。
 *
 * 用途:文件处理、记忆提取与会话标题等异步任务。
 * typed catalog 入队到 pg-boss,由独立进程 src/worker.ts 消费。
 *
 * pg-boss 的表位于独立的 `pgboss` schema,与 Drizzle 的 `public` schema 不冲突。
 *
 * pg-boss 与 pg 由 Next serverExternalPackages 保持为 Node 运行时依赖。
 */
import type {
  JobOutcome,
  QueueDefinition,
  QueuePayload,
  QueuePolicy,
} from "@/lib/jobs/catalog";

type JobHandler<T = unknown> = (data: T) => Promise<JobOutcome>;

export interface QueueAdapter {
  readonly available: boolean;
  /** 入队(返回 job id)。 */
  send<TDefinition extends QueueDefinition<object>>(
    definition: TDefinition,
    data: NoInfer<QueuePayload<TDefinition>>,
    opts?: { startAfter?: number },
  ): Promise<string>;
  /** 注册 handler(仅 worker 进程调用)。 */
  work<TDefinition extends QueueDefinition<object>>(
    definition: TDefinition,
    handler: JobHandler<QueuePayload<TDefinition>>,
  ): Promise<void>;
  /** 初始化(创建 schema/表)。 */
  start(): Promise<void>;
  /** 关闭。 */
  stop(): Promise<void>;
}

export const QUEUE_DRAIN_TIMEOUT_MESSAGE = "队列任务未在关闭期限内完成";
const QUEUE_STOP_TIMEOUT_MS = 30_000;
const QUEUE_STOP_OPTIONS = Object.freeze({
  close: true,
  graceful: true,
  wait: true,
  timeout: QUEUE_STOP_TIMEOUT_MS,
});

interface QueueBoss {
  send(name: string, data: object, opts?: object): Promise<string | null>;
  createQueue(name: string, opts?: QueuePolicy): Promise<void>;
  work(
    name: string,
    handler: (jobs: { data: unknown }[]) => Promise<void>,
  ): Promise<string>;
  start(): Promise<void>;
  stop(opts: typeof QUEUE_STOP_OPTIONS): Promise<void>;
  on(event: "error", cb: (err: unknown) => void): void;
}

interface QueueGeneration {
  readonly boss: QueueBoss;
  state: "starting" | "running" | "stopping" | "closed";
  rawStart: Promise<void>;
  ready: Promise<void>;
  closePromise: Promise<void> | null;
  readonly queuePromises: Map<string, Promise<void>>;
  readonly activeOperations: Set<Promise<unknown>>;
  readonly activeHandlers: Set<Promise<void>>;
}

let _adapterPromise: Promise<QueueAdapter> | null = null;

async function buildAdapter(): Promise<QueueAdapter> {
  const { default: PgBoss } = await import("pg-boss");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("未配置 DATABASE_URL(队列依赖 PostgreSQL)。");
  const connectionString: string = url;

  let currentGeneration: QueueGeneration | null = null;

  function createGeneration(): QueueGeneration {
    const boss = new PgBoss({ connectionString, schema: "pgboss" }) as unknown as QueueBoss;
    // pg-boss 的原始错误可能包含 SQL 参数或连接信息，只记录固定事件。
    boss.on("error", () => {
      console.error("[queue] pg-boss error");
    });

    const generation: QueueGeneration = {
      boss,
      state: "starting",
      rawStart: Promise.resolve(),
      ready: Promise.resolve(),
      closePromise: null,
      queuePromises: new Map(),
      activeOperations: new Set(),
      activeHandlers: new Set(),
    };
    const rawStart = Promise.resolve()
      .then(() => boss.start())
      .then(() => undefined);
    generation.rawStart = rawStart;
    generation.ready = rawStart
      .then(() => {
        if (generation.state === "starting") generation.state = "running";
      })
      .catch(async (error) => {
        try {
          await closeGeneration(generation);
        } catch {
          // 启动错误是本次调用的根因，清理错误不能覆盖它。
        }
        throw error;
      });
    currentGeneration = generation;
    return generation;
  }

  function start(): Promise<void> {
    const generation = currentGeneration;
    if (generation?.state === "starting" || generation?.state === "running") {
      return generation.ready;
    }
    if (generation?.state === "stopping") {
      const closing = generation.closePromise ?? closeGeneration(generation);
      return closing.catch(() => undefined).then(start);
    }

    try {
      return createGeneration().ready;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function stop(): Promise<void> {
    const generation = currentGeneration;
    return generation ? closeGeneration(generation) : Promise.resolve();
  }

  function closeGeneration(generation: QueueGeneration): Promise<void> {
    if (generation.closePromise) return generation.closePromise;
    generation.state = "stopping";

    const closing = (async () => {
      await generation.rawStart.catch(() => undefined);
      await Promise.allSettled([...generation.activeOperations]);

      const startedAt = globalThis.performance.now();
      let stopError: unknown;
      try {
        await generation.boss.stop(QUEUE_STOP_OPTIONS);
      } catch (error) {
        stopError = error;
      }
      const elapsed = globalThis.performance.now() - startedAt;
      if (stopError !== undefined) throw stopError;
      if (
        elapsed >= QUEUE_STOP_TIMEOUT_MS
        || generation.activeHandlers.size > 0
      ) {
        throw new Error(QUEUE_DRAIN_TIMEOUT_MESSAGE);
      }
    })();
    generation.closePromise = closing.finally(() => {
      generation.state = "closed";
      if (currentGeneration === generation) currentGeneration = null;
    });
    return generation.closePromise;
  }

  async function runOperation<T>(
    operation: (generation: QueueGeneration) => Promise<T>,
  ): Promise<T> {
    while (true) {
      await start();
      const generation = currentGeneration;
      if (
        !generation
        || generation.state !== "running"
        || currentGeneration !== generation
      ) {
        await generation?.closePromise?.catch(() => undefined);
        continue;
      }

      const promise = Promise.resolve().then(() => operation(generation));
      generation.activeOperations.add(promise);
      const clear = () => generation.activeOperations.delete(promise);
      void promise.then(clear, clear);
      return promise;
    }
  }

  async function ensureQueue(
    generation: QueueGeneration,
    definition: QueueDefinition<object>,
  ): Promise<void> {
    const existing = generation.queuePromises.get(definition.name);
    if (existing) return existing;

    const promise = generation.boss.createQueue(
      definition.name,
      { ...definition.policy },
    );
    generation.queuePromises.set(definition.name, promise);
    void promise.catch(() => {
      if (generation.queuePromises.get(definition.name) === promise) {
        generation.queuePromises.delete(definition.name);
      }
    });
    return promise;
  }

  return {
    available: true,
    send(definition, data, opts) {
      return runOperation(async (generation) => {
        await ensureQueue(generation, definition);
        // pg-boss 要求 data 为 object;非 object 包装一层。
        const payload = (typeof data === "object" && data !== null ? data : { value: data }) as object;
        const sendOpts = opts
          ? { ...definition.policy, startAfter: opts.startAfter }
          : { ...definition.policy };
        const id = await generation.boss.send(definition.name, payload, sendOpts);
        if (!id) throw new Error(`pg-boss 未返回 job id: ${definition.name}`);
        return id;
      });
    },
    work(definition, handler) {
      return runOperation(async (generation) => {
        await ensureQueue(generation, definition);
        // pg-boss 的 handler 接收 job 数组(批量模式);逐个派发。
        await generation.boss.work(definition.name, async (jobs) => {
          for (const job of jobs) {
            const pending = Promise.resolve()
              .then(() => handler(job.data as never))
              .then((outcome) => {
                if (outcome !== "completed" && outcome !== "noop") {
                  throw new Error("invalid job outcome");
                }
              })
              .catch(() => {
                throw new Error(definition.retryMessage);
              });
            generation.activeHandlers.add(pending);
            const clear = () => generation.activeHandlers.delete(pending);
            void pending.then(clear, clear);
            await pending;
          }
        });
      });
    },
    start,
    stop,
  };
}

/** 获取队列适配器单例(惰性)。 */
export function getQueue(): Promise<QueueAdapter> {
  if (_adapterPromise) return _adapterPromise;
  const promise = buildAdapter();
  _adapterPromise = promise;
  void promise.catch(() => {
    if (_adapterPromise === promise) _adapterPromise = null;
  });
  return promise;
}

/** 启动时初始化连接(instrumentation / worker 调用)。 */
export async function initQueue(): Promise<void> {
  const q = await getQueue();
  await q.start();
}

/** 是否有可用队列(运行时探测 pg-boss 连接)。 */
export async function queueAvailable(): Promise<boolean> {
  const q = await getQueue();
  await q.start();
  return q.available;
}
