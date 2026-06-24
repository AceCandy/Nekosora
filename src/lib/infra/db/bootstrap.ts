/**
 * 启动时 bootstrap —— **DB 连接失败即阻断启动**。
 *
 * 设计原则:
 *   - **启动时即建表**:pg 跑 drizzle migrate(消费 `drizzle/pg/*.sql`),
 *     sqlite 跑 drizzle migrate(消费 `drizzle/sqlite/*.sql`)。migrate 幂等,
 *     已有表不受影响。建表不再是开发者的显式职责,而是启动流程的一部分。
 *   - **DB 连不上直接阻断**:连通性探测(执行真实查询)失败 → throw,Next instrumentation
 *     失败 → 进程不启动。避免"启动了但运行时才报错"。
 *   - pgvector 扩展保留"尽力而为":某些托管 PG 禁建扩展,那种情况下只要不用
 *     RAG/memory 就不影响核心,所以只 warn 不阻断。
 *   - 首个管理员创建:无用户时用 SEED_ADMIN_* 创建(role=admin)。失败 → 阻断启动。
 *
 * 全程动态 import 驱动,避免 Edge instrumentation 编译时把 pg/better-sqlite3 拉入
 * (util/types 在 Turbopack bundler 下解析失败)。
 *
 * ⚠️ 本文件顶层**不能有任何业务 import**。instrumentation.ts 用动态 import 拉本模块,
 * 但 bundler 仍会把本模块的静态依赖图打包进 Edge bundle。
 * drizzle-orm 的 barrel → node-postgres → pg → util/types 在 Turbopack 下解析失败。
 * 故全部用函数内动态 import,与 src/lib/infra/db/index.ts 的 getDb() 同款模式。
 */
export async function bootstrapDatabase(): Promise<void> {
  const { getDb, getSchema, isPg } = await import("@/lib/infra/db");
  const db = await getDb();

  // --- 步骤 1:连通性探测(执行真实查询),失败即阻断 ---
  await checkConnection(db, isPg);

  // --- 步骤 2:自动建表(幂等 migrate) ---
  await runMigrations(db, isPg);

  // --- 步骤 3:尽力而为的 pgvector 扩展,失败不阻断 ---
  if (isPg) {
    await ensurePgvector(db);
  }

  // --- 步骤 4:首个管理员(幂等 + 失败阻断) ---
  await ensureFirstAdmin(db, await getSchema());
}

/**
 * 连通性探测:执行一条轻量查询。连不上库 → throw 阻断启动。
 * 不能只靠"import 成功 / 拿到 db 对象"判断,必须实际打到 DB。
 */
async function checkConnection(db: unknown, isPg: boolean): Promise<void> {
  const { sql } = await import("drizzle-orm");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).execute(sql`select 1`);
    console.log(`[bootstrap] ✅ DB 连接正常(${isPg ? "pg" : "sqlite"})`);
  } catch (e) {
    throw new Error(
      `[bootstrap] DB 连接失败,启动中止:${e instanceof Error ? e.message : e}`,
    );
  }
}

/**
 * 自动建表:跑 drizzle migrate,消费已生成的迁移 SQL(幂等)。
 * 迁移产物路径必须与 drizzle.pg.config.ts / drizzle.sqlite.config.ts 的 `out` 一致。
 */
async function runMigrations(db: unknown, isPg: boolean): Promise<void> {
  try {
    if (isPg) {
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      await migrate(db as never, { migrationsFolder: "drizzle/pg" });
    } else {
      const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
      await migrate(db as never, { migrationsFolder: "drizzle/sqlite" });
    }
    console.log(`[bootstrap] ✅ 数据库表已就绪(${isPg ? "pg" : "sqlite"} migrate 完成)`);
  } catch (e) {
    throw new Error(
      `[bootstrap] 自动建表失败,启动中止:${e instanceof Error ? e.message : e}`,
    );
  }
}

/**
 * PG 模式:确保 pgvector 扩展存在(失败警告,不阻断)。
 * RAG/memory 的向量列依赖它;某些托管 PG 禁建扩展,那种情况下只要
 * 不用 RAG/memory 就不影响核心,所以只警告。
 */
async function ensurePgvector(db: unknown): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).execute(`CREATE EXTENSION IF NOT EXISTS vector`);
    console.log("[bootstrap] pgvector 扩展就绪。");
  } catch (e) {
    console.warn(
      "[bootstrap] pgvector 扩展创建失败(忽略,仅影响 RAG/memory 功能):",
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * 无用户时创建首个管理员(role=admin)。有任意用户即跳过(幂等)。
 * 失败 → throw 阻断启动(配置错误或 DB 状态异常应被尽早暴露)。
 */
async function ensureFirstAdmin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
): Promise<void> {
  const userTable = schema.user;

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
  const [row] = await db
    .select()
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);
  if (!row) throw new Error("[bootstrap] 管理员账号创建后未能查回");

  await db
    .update(userTable)
    .set({ role: "admin", status: "active" })
    .where(eq(userTable.id, row.id));

  console.log(`[bootstrap] ✅ 管理员创建成功:id=${row.id} email=${email} role=admin`);
}
