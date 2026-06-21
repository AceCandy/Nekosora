/**
 * 启动时自动 bootstrap —— 幂等,后续启动跳过。
 *
 *   1. pg 模式:运行 drizzle migrate(幂等,查 __drizzle_migrations 表跳过已执行)
 *      + 确保 pgvector 扩展存在(失败只警告,不阻断 —— 某些托管 PG 禁建扩展,
 *        但只要不用 RAG/memory 功能就不影响核心)。
 *   2. sqlite 模式:不走 migrate(drizzle/sqlite 文件夹不存在,push 语义与 migrate 冲突)。
 *      只检查 user 表是否存在;不存在则引导用户跑 `pnpm db:push:sqlite`。
 *   3. 无论哪种模式:若无任何用户,用 SEED_ADMIN_* 创建首个管理员(role=admin)。
 *
 * 全程动态 import 驱动,避免 Edge instrumentation 编译时把 pg/better-sqlite3 拉入
 * (util/types 在 Turbopack bundler 下解析失败)。
 *
 * 失败策略:throw,由 instrumentation.ts 的 register() 透传 —— 硬阻断启动,
 * 让"启动了但用不了"的问题在启动阶段就暴露。
 *
 * ⚠️ 本文件顶层**不能有任何业务 import**。instrumentation.ts 用动态 import 拉本模块,
 * 但 bundler 仍会把本模块的静态依赖图打包进 Edge bundle。
 * drizzle-orm 的 barrel → node-postgres → pg → util/types 在 Turbopack 下解析失败。
 * 故全部用函数内动态 import,与 src/lib/infra/db/index.ts 的 getDb() 同款模式。
 */
export async function bootstrapDatabase(): Promise<void> {
  const { getDb, getSchema, isPg } = await import("@/lib/infra/db");
  const db = await getDb();
  const schema = getSchema();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userTable = (schema as any).user;

  // --- 步骤 1:建表 / 迁移 ---
  if (isPg) {
    await migratePg(db);
  } else {
    await ensureSqliteTables(db);
  }

  // --- 步骤 2:首个管理员(幂等,有任意用户即跳过) ---
  const existing = await db.select().from(userTable).limit(1);
  if (existing.length > 0) {
    console.log(`[bootstrap] 已有 ${existing.length}+ 用户,跳过管理员创建。`);
    return;
  }

  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@nekusora.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "change-me-on-first-login";
  const name = process.env.SEED_ADMIN_NAME ?? "Administrator";

  console.log(`[bootstrap] 无用户,创建首个管理员 ${email} ...`);
  const { getAuth } = await import("@/auth");
  const auth = await getAuth();
  if (!auth) throw new Error("[bootstrap] auth 初始化失败");

  await auth.api.signUpEmail({ body: { email, password, name } });

  // signUpEmail 后按 email 查回并置 admin。
  const { eq } = await import("drizzle-orm");
  const [row] = await db.select().from(userTable).where(eq(userTable.email, email)).limit(1);
  if (!row) throw new Error("[bootstrap] 管理员账号创建后未能查回");

  await db
    .update(userTable)
    .set({ role: "admin", status: "active" })
    .where(eq(userTable.id, row.id));

  console.log(`[bootstrap] ✅ 管理员创建成功:id=${row.id} email=${email} role=admin`);
}

/**
 * PG 模式迁移:
 *   1. CREATE EXTENSION IF NOT EXISTS vector(失败警告,不阻断)
 *   2. drizzle migrate(db, { migrationsFolder: "./drizzle/pg" }) —— 幂等
 */
async function migratePg(db: unknown): Promise<void> {
  // pgvector 扩展:RAG/memory 的向量列依赖它。某些托管 PG 禁止建扩展,
  // 那种情况下只要不用 RAG/memory 功能就不影响核心,所以只警告不阻断。
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).execute(`CREATE EXTENSION IF NOT EXISTS vector`);
    console.log("[bootstrap] pgvector 扩展就绪。");
  } catch (e) {
    console.warn(
      `[bootstrap] pgvector 扩展创建失败(忽略,仅影响 RAG/memory 功能):`,
      e instanceof Error ? e.message : e,
    );
  }

  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const path = await import("node:path");
  const migrationsFolder = path.resolve(process.cwd(), "./drizzle/pg");
  await migrate(db as never, { migrationsFolder });
  console.log("[bootstrap] PG 迁移完成(幂等,已执行的会跳过)。");
}

/**
 * SQLite 模式:只检查 user 表是否存在。
 * SQLite 走 `db:push:sqlite`(schema diff 直推)语义,与 migrate 不兼容,
 * 这里不做建表 —— 留给用户一次性手工 push。
 */
async function ensureSqliteTables(db: unknown): Promise<void> {
  // drizzle 的 better-sqlite3 wrapper 用 sql template 表达原生查询。
  const { sql } = await import("drizzle-orm");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: unknown[] = await (db as any).all(
    sql`SELECT name FROM sqlite_master WHERE type='table' AND name='user'`,
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      "[bootstrap] SQLite user 表不存在。请先运行 `pnpm db:push:sqlite` 建表后重启。",
    );
  }
  console.log("[bootstrap] SQLite user 表已存在。");
}
