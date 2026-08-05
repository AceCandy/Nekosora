/**
 * 数据库连接工厂 —— PostgreSQL(+pgvector)。
 *
 * 关键:drizzle 入口(node-postgres)与底层 pg 驱动用动态 import 惰性加载,
 * 避免 Turbopack 在 Edge instrumentation 编译时把 pg 打包
 * (其依赖 util/types 在 bundler 下解析失败)。
 *
 * 业务代码统一 import { getDb, getSchema, closeDb } from "@/lib/infra/db";
 * 永远不直接 import schema 或驱动模块。
 */

// db 类型弱化为 any:drizzle 的查询构建器签名在跨表联合时类型不互通,
// 业务代码统一通过 schema 表引用驱动查询,故此处保留 any 换取可调用性。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;
let _db: AnyDb | null = null;
let _pool: unknown | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = Record<string, any>;
let _schema: AnySchema | null = null;
// in-flight guard:并发调用 getDb()/loadSchema() 时复用同一个 promise,
// 避免 double-init 导致的连接池泄漏。
let _schemaPromise: Promise<AnySchema> | null = null;
let _dbPromise: Promise<AnyDb> | null = null;

function loadSchema(): Promise<AnySchema> {
  if (_schemaPromise) return _schemaPromise;
  _schemaPromise = (async () => {
    if (_schema) return _schema;
    const mod = await import("@/db/schema/pg");
    _schema = mod as unknown as AnySchema;
    return _schema;
  })();
  return _schemaPromise;
}

/** 获取已加载的业务 schema(必须先调用过 getDb)。 */
export function getSchema(): AnySchema {
  if (!_schema) throw new Error("schema 尚未加载,请先 await getDb()");
  return _schema;
}

/** 获取 db 实例(惰性初始化,驱动与 schema 懒加载,in-flight guard 防并发 double-init)。 */
export function getDb(): Promise<AnyDb> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = (async () => {
    if (_db) return _db;
    const schema = await loadSchema();

    // 动态加载 drizzle pg 入口 + pg 驱动,避免静态 import 被 Edge 打包。
    const { drizzle: drizzlePg } = await import("drizzle-orm/node-postgres");
    const { default: pg } = await import("pg");
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("未配置 DATABASE_URL(仅支持 PostgreSQL)。");
    // 连接池上限:主进程(Next.js)与 worker 各持独立 Pool,总连接 = 各进程 max 之和,
    // 须低于 PG max_connections 余量(留出 drizzle studio / 运维连接)。按部署规格调 DB_POOL_MAX。
    const poolMax = Number(process.env.DB_POOL_MAX ?? 20);
    if (!Number.isInteger(poolMax) || poolMax < 1) {
      throw new Error("DB_POOL_MAX 非法,期望正整数");
    }
    const Pool = pg.Pool;
    _pool = new Pool({ connectionString: url, max: poolMax });
    _db = drizzlePg({ client: _pool as never, schema });
    return _db;
  })().catch((e) => {
    // init 失败要清掉 in-flight 标记,否则后续调用会一直拿到 rejected promise。
    _dbPromise = null;
    throw e;
  });
  return _dbPromise;
}

/** 关闭连接(测试/优雅关闭用)。 */
export async function closeDb(): Promise<void> {
  // 先清 in-flight guard,避免关闭期间新调用复用正在被关闭的实例。
  const dbPromise = _dbPromise;
  _dbPromise = null;
  _schemaPromise = null;
  // 等待可能正在进行的 init 完成(若并发进入)再关闭。
  if (dbPromise) {
    try {
      await dbPromise;
    } catch {
      // init 本身就失败了,无需再关闭。
    }
  }
  if (_pool && typeof (_pool as { end?: () => Promise<void> }).end === "function") {
    await (_pool as { end: () => Promise<void> }).end();
  }
  _db = null;
  _pool = null;
  _schema = null;
}
