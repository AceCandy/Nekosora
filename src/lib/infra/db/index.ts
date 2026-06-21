/**
 * 数据库 dialect factory —— PostgreSQL(+pgvector)或 SQLite(+sqlite-vec)降级。
 *
 * 选择逻辑(优先级从高到低):
 *   1. 显式 DB_DIALECT=pg|sqlite
 *   2. 存在 DATABASE_URL → pg
 *   3. 否则 → sqlite(SQLITE_PATH,默认 ./data/local.db)
 *
 * 关键:驱动(pg / better-sqlite3)用动态 import 惰性加载,避免 Turbopack
 * 在 SQLite 模式下也打包 pg(其依赖 util/types 在 bundler 下解析失败)。
 *
 * 业务代码统一 import { db, getDb, getSchema, isPg, dbDialect } from "@/lib/infra/db";
 * 永远不直接 import 具体 dialect 模块。
 */
// 注意:drizzle 的 dialect 入口(node-postgres / better-sqlite3)和底层驱动(pg /
// better-sqlite3)都用动态 import,避免 Turbopack 在 Edge instrumentation 编译时
// 把 pg 打包(其依赖 util/types 在 bundler 下解析失败)。

export type DbDialect = "pg" | "sqlite";

function resolveDialect(): DbDialect {
  const explicit = process.env.DB_DIALECT?.toLowerCase();
  if (explicit === "pg" || explicit === "sqlite") return explicit;
  if (process.env.DATABASE_URL) return "pg";
  return "sqlite";
}

export const dbDialect: DbDialect = resolveDialect();
export const isPg = dbDialect === "pg";

// db 联合类型在 .select()/.update() 等查询方法上签名不兼容(PG/SQLite query builder
// 类型不互通)——这是 dual-dialect 工厂的固有难题。业务代码统一通过 schema 表引用
// 驱动查询,故此处将导出类型弱化为 any,换取可调用性。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;
let _db: AnyDb | null = null;
let _pool: unknown | null = null;
let _sqlite: unknown | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = Record<string, any>;
let _schema: AnySchema | null = null;
// in-flight guard:并发调用 getDb()/loadSchema() 时复用同一个 promise,
// 避免 double-init 导致的连接池/文件句柄泄漏。
let _schemaPromise: Promise<AnySchema> | null = null;
let _dbPromise: Promise<AnyDb> | null = null;

function loadSchema(): Promise<AnySchema> {
  if (_schemaPromise) return _schemaPromise;
  _schemaPromise = (async () => {
    if (_schema) return _schema;
    // 静态条件 import:两份 schema 导出名一致,按 dialect 选择。
    if (isPg) {
      const mod = await import("@/db/schema/pg");
      _schema = mod as unknown as AnySchema;
    } else {
      const mod = await import("@/db/schema/sqlite");
      _schema = mod as unknown as AnySchema;
    }
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

    if (isPg) {
      // 动态加载 drizzle pg 入口 + pg 驱动,避免静态 import 被 Edge 打包。
      const { drizzle: drizzlePg } = await import("drizzle-orm/node-postgres");
      const { default: pg } = await import("pg");
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error("pg 模式需要配置 DATABASE_URL");
      const Pool = pg.Pool;
      _pool = new Pool({ connectionString: url, max: 10 });
      _db = drizzlePg({ client: _pool as never, schema });
    } else {
      // 动态加载 drizzle sqlite 入口 + better-sqlite3 驱动。
      const { drizzle: drizzleSqlite } = await import("drizzle-orm/better-sqlite3");
      const { default: Database } = await import("better-sqlite3");
      const path = process.env.SQLITE_PATH ?? "./data/local.db";
      _sqlite = new Database(path);
      (_sqlite as { pragma: (s: string) => void }).pragma("journal_mode = WAL");
      (_sqlite as { pragma: (s: string) => void }).pragma("foreign_keys = ON");
      _db = drizzleSqlite(_sqlite as never, { schema });
    }
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
  if (_sqlite && typeof (_sqlite as { close?: () => void }).close === "function") {
    (_sqlite as { close: () => void }).close();
  }
  _db = null;
  _pool = null;
  _sqlite = null;
  _schema = null;
}

export { dbDialect as dialect };
