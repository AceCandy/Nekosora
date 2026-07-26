/**
 * 任务队列 —— pg-boss(PostgreSQL)。
 *
 * 用途:文件处理流水线(extract → chunk → embed → rag_ready)等异步任务。
 * 入队到 pg-boss,由独立进程 src/worker.ts 消费。
 *
 * pg-boss 的表位于独立的 `pgboss` schema,与 Drizzle 的 `public` schema 不冲突。
 *
 * 注意:pg-boss → pg 驱动用变量路径动态 import,避免 Edge instrumentation
 * 编译时把 pg 拉入(util/types 在 bundler 下解析失败)。
 */
type JobHandler<T = unknown> = (data: T) => Promise<void>;

interface QueueAdapter {
  readonly available: boolean;
  /** 入队(返回 job id)。 */
  send<T>(name: string, data: T, opts?: { startAfter?: number }): Promise<string>;
  /** 注册 handler(仅 worker 进程调用)。 */
  work<T>(name: string, handler: JobHandler<T>): Promise<void>;
  /** 初始化(创建 schema/表)。 */
  start(): Promise<void>;
  /** 关闭。 */
  stop(): Promise<void>;
}

let _adapterPromise: Promise<QueueAdapter> | null = null;

async function buildAdapter(): Promise<QueueAdapter> {
  // 用变量路径动态 import 阻断 Turbopack 静态分析 —— 否则 Edge instrumentation
  // 编译会顺着 pg-boss → pg 把 util/types 拉进来(bundler 下解析失败)。
  const bossModule = "pg-boss";
  const { default: PgBoss } = (await import(/* @vite-ignore */ bossModule)) as {
    default: new (opts: { connectionString: string; schema: string }) => {
      send: (name: string, data: object, opts?: object) => Promise<string | null>;
      createQueue: (name: string) => Promise<void>;
      work: (name: string, handler: (jobs: { data: unknown }[]) => Promise<void>) => Promise<string>;
      start: () => Promise<void>;
      stop: () => Promise<void>;
      on: (event: "error", cb: (err: unknown) => void) => void;
    };
  };
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("未配置 DATABASE_URL(队列依赖 PostgreSQL)。");

  const boss = new PgBoss({
    connectionString: url,
    schema: "pgboss",
    // 完成任务归档保留时间,默认即可。
  });
  // pg-boss 用 EventEmitter 派发错误;不监听会变 ERR_UNHANDLED_ERROR 崩进程。
  boss.on("error", (err) => {
    console.error("[queue] pg-boss error:", err);
  });

  let startPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  const queuePromises = new Map<string, Promise<void>>();
  const activeOperations = new Set<Promise<unknown>>();

  function start(): Promise<void> {
    if (startPromise) return startPromise;
    const promise = (stopPromise ?? Promise.resolve())
      .then(() => boss.start())
      .then(() => undefined);
    startPromise = promise;
    void promise.catch(() => {
      if (startPromise === promise) startPromise = null;
    });
    return promise;
  }

  function stop(): Promise<void> {
    if (stopPromise) return stopPromise;
    const starting = startPromise;
    startPromise = null;
    const promise = (starting ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => Promise.allSettled([...activeOperations]))
      .then(() => boss.stop())
      .then(() => undefined);
    stopPromise = promise;
    const clear = () => {
      if (stopPromise === promise) stopPromise = null;
    };
    void promise.then(clear, clear);
    return promise;
  }

  async function runOperation<T>(operation: () => Promise<T>): Promise<T> {
    while (true) {
      await start();
      if (stopPromise) {
        await stopPromise;
        continue;
      }

      const promise = Promise.resolve().then(operation);
      activeOperations.add(promise);
      const clear = () => activeOperations.delete(promise);
      void promise.then(clear, clear);
      return promise;
    }
  }

  async function ensureQueue(name: string): Promise<void> {
    const existing = queuePromises.get(name);
    if (existing) return existing;

    const promise = boss.createQueue(name);
    queuePromises.set(name, promise);
    void promise.catch(() => {
      if (queuePromises.get(name) === promise) queuePromises.delete(name);
    });
    return promise;
  }

  return {
    available: true,
    send(name, data, opts) {
      return runOperation(async () => {
        await ensureQueue(name);
        // pg-boss 要求 data 为 object;非 object 包装一层。
        const payload = (typeof data === "object" && data !== null ? data : { value: data }) as object;
        const sendOpts = opts ? { startAfter: opts.startAfter } : undefined;
        const id = await boss.send(name, payload, sendOpts as never);
        if (!id) throw new Error(`pg-boss 未返回 job id: ${name}`);
        return id;
      });
    },
    work(name, handler) {
      return runOperation(async () => {
        await ensureQueue(name);
        // pg-boss 的 handler 接收 job 数组(批量模式);逐个派发。
        await boss.work(name, async (jobs) => {
          for (const job of jobs) {
            await handler(job.data as never);
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
