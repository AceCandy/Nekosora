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

let _adapter: QueueAdapter | null = null;

async function buildAdapter(): Promise<QueueAdapter> {
  // 用变量路径动态 import 阻断 Turbopack 静态分析 —— 否则 Edge instrumentation
  // 编译会顺着 pg-boss → pg 把 util/types 拉进来(bundler 下解析失败)。
  const bossModule = "pg-boss";
  const { default: PgBoss } = (await import(/* @vite-ignore */ bossModule)) as {
    default: new (opts: { connectionString: string; schema: string }) => {
      send: (name: string, data: object, opts?: object) => Promise<string | null>;
      work: (name: string, handler: (jobs: { data: unknown }[]) => Promise<void>) => Promise<string>;
      start: () => Promise<void>;
      stop: () => Promise<void>;
    };
  };
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("未配置 DATABASE_URL(队列依赖 PostgreSQL)。");

  const boss = new PgBoss({
    connectionString: url,
    schema: "pgboss",
    // 完成任务归档保留时间,默认即可。
  });

  return {
    available: true,
    async send(name, data, opts) {
      // pg-boss 要求 data 为 object;非 object 包装一层。
      const payload = (typeof data === "object" && data !== null ? data : { value: data }) as object;
      const sendOpts = opts ? { startAfter: opts.startAfter } : undefined;
      const id = await boss.send(name, payload, sendOpts as never);
      return id ?? "";
    },
    async work(name, handler) {
      // pg-boss 的 handler 接收 job 数组(批量模式);逐个派发。
      await boss.work(name, async (jobs) => {
        for (const job of jobs) {
          await handler(job.data as never);
        }
      });
    },
    async start() {
      await boss.start();
    },
    async stop() {
      await boss.stop();
    },
  };
}

/** 获取队列适配器单例(惰性)。 */
export async function getQueue(): Promise<QueueAdapter> {
  if (!_adapter) _adapter = await buildAdapter();
  return _adapter;
}

/** 启动时初始化连接(instrumentation / worker 调用)。 */
export async function initQueue(): Promise<void> {
  const q = await getQueue();
  await q.start();
}

/** 是否有可用队列(运行时探测 pg-boss 连接)。 */
export async function queueAvailable(): Promise<boolean> {
  const q = await getQueue();
  return q.available;
}
