/**
 * 任务队列降级 —— pg-boss(PostgreSQL)或 no-op(SQLite 回退)。
 *
 * 用途:文件处理流水线(extract → chunk → embed → rag_ready)等异步任务。
 * PG 模式:入队到 pg-boss,由独立进程 src/worker.ts 消费。
 * SQLite 模式:无独立 worker,入队退化为"直接同步执行 handler"(或丢弃,
 *   取决于调用方选择)。对内部团队规模够用;需要重负载时切回 PG。
 *
 * pg-boss 的表位于独立的 `pgboss` schema,与 Drizzle 的 `public` schema 不冲突。
 */
// 注意:不 import { isPg } from db —— 那会静态拉入 pg 驱动(bundler 在 Edge
// instrumentation 场景下解析失败)。这里直接读环境变量判断 dialect。
function resolveIsPg(): boolean {
  const explicit = process.env.DB_DIALECT?.toLowerCase();
  if (explicit === "pg" || explicit === "sqlite") return explicit === "pg";
  return !!process.env.DATABASE_URL;
}

type JobHandler<T = unknown> = (data: T) => Promise<void>;

interface QueueAdapter {
  readonly available: boolean;
  /** 入队(返回 job id;SQLite 模式返回空串)。 */
  send<T>(name: string, data: T, opts?: { startAfter?: number }): Promise<string>;
  /** 注册 handler(仅 worker 进程调用)。SQLite 模式为 no-op。 */
  work<T>(name: string, handler: JobHandler<T>): Promise<void>;
  /** 初始化(创建 schema/表)。 */
  start(): Promise<void>;
  /** 关闭。 */
  stop(): Promise<void>;
}

let _adapter: QueueAdapter | null = null;

/** SQLite 模式的 no-op 适配器。 */
const noopAdapter: QueueAdapter = {
  available: false,
  async send() {
    return "";
  },
  async work() {
    /* no-op: SQLite 模式无独立 worker */
  },
  async start() {
    /* no-op */
  },
  async stop() {
    /* no-op */
  },
};

async function buildAdapter(): Promise<QueueAdapter> {
  if (!resolveIsPg()) return noopAdapter;

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
  const url = process.env.DATABASE_URL!;

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

/** instrumentation.ts 调用:启动时初始化连接(仅 PG 模式)。 */
export async function initQueue(): Promise<void> {
  const q = await getQueue();
  await q.start();
}

/** 是否有可用队列(PG 模式)。SQLite 模式返回 false。 */
export async function queueAvailable(): Promise<boolean> {
  const q = await getQueue();
  return q.available;
}
