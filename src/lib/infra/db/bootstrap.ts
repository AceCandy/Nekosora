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

  // --- 步骤 2:PG 迁移里包含 vector 列,扩展必须在 migrate 前尝试创建 ---
  if (isPg) {
    await ensurePgvector(db);
  }

  // --- 步骤 3:自动建表(幂等 migrate) ---
  await runMigrations(db, isPg);

  // --- 步骤 4:首个管理员(幂等 + 失败阻断) ---
  await ensureFirstAdmin(db, await getSchema());

  // --- 步骤 5:内置输出样式预设(幂等,失败不阻断) ---
  await ensureBuiltinRenderStyles(db, await getSchema());

  // 内置输出模式预设(幂等,失败不阻断) —— 「结构化输出」引导 AI 用 chart/metric/table 代码块
  await ensureBuiltinOutputModes(db, await getSchema());

  // --- 步骤 6:清理上次崩溃残留的「生成中」标记 ---
  await clearStaleGenerating(db, await getSchema());
}

/**
 * 连通性探测:执行一条轻量查询。连不上库 → throw 阻断启动。
 * 不能只靠"import 成功 / 拿到 db 对象"判断,必须实际打到 DB。
 */
async function checkConnection(db: unknown, isPg: boolean): Promise<void> {
  const { sql } = await import("drizzle-orm");
  try {
    // PG 与 better-sqlite3 的 drizzle 实例可用方法不同,这里按 dialect 走真实轻量查询。
    if (isPg) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).execute(sql`select 1`);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).run(sql`select 1`);
    }
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
export async function runMigrations(db: unknown, isPg: boolean): Promise<void> {
  // 逃生口:远端表结构已由外部托管(如手工建好 / DBA 维护)时,
  // 设置 BOOTSTRAP_SKIP_MIGRATE=1 跳过本地 migrate,避免迁移产物不一致阻断启动。
  if (process.env.BOOTSTRAP_SKIP_MIGRATE === "1") {
    console.log(`[bootstrap] ⏭️ 已跳过 migrate(BOOTSTRAP_SKIP_MIGRATE=1,假定表结构已就绪)`);
    return;
  }
  try {
    if (isPg) {
      await adoptExistingPgBaselineIfNeeded(db);
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

const PG_BASELINE_TYPES = [
  "access_scope",
  "api_key_kind",
  "binding_scope",
  "message_status",
  "provider_protocol",
] as const;

const PG_BASELINE_TABLES = [
  "account",
  "api_keys",
  "artifacts",
  "context_snapshots",
  "conversation_projects",
  "conversation_shares",
  "conversations",
  "file_chunks",
  "file_objects",
  "global_models",
  "global_providers",
  "global_routes",
  "image_jobs",
  "instruction_cards",
  "key_model_bindings",
  "knowledge_bases",
  "mcp_servers",
  "messages",
  "output_modes",
  "prompt_templates",
  "render_styles",
  "runs",
  "session",
  "system_settings",
  "tool_calls",
  "usage_logs",
  "user",
  "user_memories",
  "user_models",
  "user_providers",
  "user_settings",
  "verification",
] as const;

/**
 * 兼容旧流程:如果 PG schema 已经由 push/手工/旧启动流程完整建好,但还没有
 * Drizzle migrator 记录,直接补基线记录,避免重新执行 0000 SQL 撞 duplicate_object。
 * 若只存在部分对象,说明库处于半初始化状态,必须显式重置或外部接管,不能静默跳过。
 */
async function adoptExistingPgBaselineIfNeeded(db: unknown): Promise<void> {
  await ensurePgMigrationTable(db);

  const existingMigrations = await pgRows<{ created_at: string | number }>(
    db,
    "select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1",
  );
  if (existingMigrations.length > 0) return;

  const existingTypes = await pgNameSet(
    db,
    `select t.typname as name
     from pg_type t
     join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
       and t.typtype = 'e'
       and t.typname in (${quotedList(PG_BASELINE_TYPES)})`,
  );
  const existingTables = await pgNameSet(
    db,
    `select tablename as name
     from pg_tables
     where schemaname = 'public'
       and tablename in (${quotedList(PG_BASELINE_TABLES)})`,
  );

  const missingTypes = PG_BASELINE_TYPES.filter((name) => !existingTypes.has(name));
  const missingTables = PG_BASELINE_TABLES.filter((name) => !existingTables.has(name));
  const existingObjectCount = existingTypes.size + existingTables.size;

  if (existingObjectCount === 0) return;

  // 仅残留 enum 时可以继续执行基线迁移:0000 SQL 的 CREATE TYPE 已做 duplicate_object 幂等。
  if (existingTables.size === 0) return;

  if (missingTypes.length > 0 || missingTables.length > 0) {
    const missing = [...missingTypes, ...missingTables].slice(0, 12).join(", ");
    throw new Error(
      `[bootstrap] PG 已存在部分基线对象但没有 Drizzle 迁移记录,不能安全自动迁移。` +
        `已存在对象数=${existingObjectCount},缺失示例=${missing || "无"}。` +
        `如果这是一次性开发库,请清空 PG 数据卷/数据库后重启;` +
        `如果表结构由外部维护且确认完整,设置 BOOTSTRAP_SKIP_MIGRATE=1。`,
    );
  }

  const baseline = await readFirstMigrationMeta("drizzle/pg");
  await pgExecute(
    db,
    `insert into drizzle.__drizzle_migrations ("hash", "created_at") values ('${baseline.hash}', ${baseline.folderMillis})`,
  );
  console.log("[bootstrap] ✅ 已收养现有 PG 基线 schema,补写 Drizzle 迁移记录");
}

async function ensurePgMigrationTable(db: unknown): Promise<void> {
  await pgExecute(db, "create schema if not exists drizzle");
  await pgExecute(
    db,
    `create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )`,
  );
}

async function readFirstMigrationMeta(
  migrationsFolder: string,
): Promise<{ hash: string; folderMillis: number }> {
  const { readMigrationFiles } = await import("drizzle-orm/migrator");
  const [first] = readMigrationFiles({ migrationsFolder });
  if (!first) throw new Error(`[bootstrap] 未找到迁移基线:${migrationsFolder}`);
  if (!/^[a-f0-9]{64}$/i.test(first.hash)) {
    throw new Error(`[bootstrap] 迁移 hash 异常:${first.hash}`);
  }
  return { hash: first.hash, folderMillis: first.folderMillis };
}

async function pgNameSet(db: unknown, query: string): Promise<Set<string>> {
  const rows = await pgRows<{ name: string }>(db, query);
  return new Set(rows.map((row) => row.name));
}

async function pgRows<T>(db: unknown, query: string): Promise<T[]> {
  const result = await pgExecute(db, query);
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

async function pgExecute(db: unknown, query: string): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).execute(query);
}

function quotedList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
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

/**
 * 内置输出样式预设(幂等 upsert,失败不阻断启动)。
 *
 * 按 cssClass 查找:不存在则插入,存在则刷新 css/name/description/icon(保证升级时
 * 内置样式随版本演进)。cssClass 与 builtin 标记永不改,作为已发布 CSS 的稳定锚点。
 * 内置样式遵守 DESIGN:星云白/暮色黑系,无彩色粗条,靠字重/间距/细分线分层级。
 */
async function ensureBuiltinRenderStyles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
): Promise<void> {
  try {
    const { eq } = await import("drizzle-orm");
    const t = schema.renderStyles;
    // paper 为「输出样式」模板范本:杂志感米色纸面 + 红色色条,使用 custom 渲染器以支持
    // 完整 CSS(含高级组件 class)。新建皮肤时复制本预设,改 cssClass 前缀(rs-paper→rs-xxx)
    // 与 BUILTIN_PAPER_CSS 中的 --pp-* 变量即可。
    const presets = [
      { cssClass: "paper", name: "纸面杂志", description: "杂志感米色纸面与红色标题色条", icon: "Newspaper", sortOrder: 0, renderer: "custom" as const, css: BUILTIN_PAPER_CSS },
    ];

    for (const p of presets) {
      const [existing] = await db.select({ id: t.id }).from(t).where(eq(t.cssClass, p.cssClass)).limit(1);
      if (existing) {
        await db
          .update(t)
          .set({ name: p.name, description: p.description, icon: p.icon, css: p.css, renderer: p.renderer, sortOrder: p.sortOrder, updatedAt: new Date() })
          .where(eq(t.id, existing.id));
      } else {
        await db.insert(t).values({
          name: p.name,
          description: p.description,
          cssClass: p.cssClass,
          css: p.css,
          icon: p.icon,
          renderer: p.renderer,
          builtin: true,
          enabled: true,
          sortOrder: p.sortOrder,
        });
      }
    }

    // 硬删已废弃的内置样式(曾内置、现不在 presets 中的记录):直接从表里删除。
    // 历史 conversation.renderStyleId 若指向被删样式,聊天页 CSS 聚合只取 enabled 列表、
    // 选用栏 find 不到即回退默认渲染,不影响消息可见性。
    const presetClasses = new Set(presets.map((p) => p.cssClass));
    const builtins = await db.select({ id: t.id, cssClass: t.cssClass }).from(t).where(eq(t.builtin, true));
    for (const row of builtins) {
      if (!presetClasses.has(row.cssClass)) {
        await db.delete(t).where(eq(t.id, row.id));
      }
    }
    console.log(`[bootstrap] ✅ 内置输出样式预设就绪(${presets.length} 条)`);
  } catch (e) {
    console.warn("[bootstrap] 内置输出样式预设写入失败(忽略):", e instanceof Error ? e.message : e);
  }
}

/** 「结构化输出」outputMode 的 systemPrompt:引导模型用 chart/metric/table 代码块展示数据。 */
const BUILTIN_STRUCTURED_OUTPUT_PROMPT = `当回答涉及数据、指标或对比时，优先用结构化代码块展示，而不是用文字罗列数字。仅在有明确数据展示需要时使用，普通对话仍用自然语言，正文其余部分仍用 markdown。

可用类型与 JSON 格式:

柱状/折线/饼图/面积图用 chart:
\`\`\`chart
{"type":"bar","title":"标题","xKey":"day","series":[{"key":"calls","label":"调用"}],"data":[{"day":"周一","calls":120}]}
\`\`\`
type 可选 bar/line/pie/area。pie 时 series 取首个 key 作为数值字段，xKey 作为名称字段。

关键指标用 metric(单个或多个):
\`\`\`metric
{"label":"QPS","value":120,"unit":"/s","trend":"up","delta":"+12%"}
\`\`\`
多个指标用数组形式:
\`\`\`metric
[{"label":"最高温","value":35,"unit":"℃","trend":"up"},{"label":"最低温","value":22,"unit":"℃","trend":"flat"}]
\`\`\`
trend 可选 up/down/flat(方向)或 high/medium/low(程度)。

多列结构化数据用 table:
\`\`\`table
{"columns":[{"key":"name","label":"名称"},{"key":"v","label":"数值","align":"right"}],"rows":[{"name":"A","v":"100"}]}
\`\`\`
column 的 align 可选 left/center/right；emphasis 为 true 时该列加粗。

强调提示用 callout(警告/提示/注意/错误):
\`\`\`callout
{"type":"warning","title":"额度将耗尽","body":"剩余请求不足 5%,请及时扩容。"}
\`\`\`
type 可选 warning/tip/note/error。

代码块内必须是合法 JSON。`;

/**
 * 内置输出模式预设(幂等 upsert,失败不阻断启动)。
 *
 * 按固定 id 查找:不存在则插入,存在则刷新 systemPrompt/name/description/icon/sortOrder。
 * 前端结构化块识别与渲染不依赖此 outputMode(能力常开);此预设仅用于引导 AI 主动产出。
 */
async function ensureBuiltinOutputModes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
): Promise<void> {
  try {
    const { eq } = await import("drizzle-orm");
    const t = schema.outputModes;
    const id = "builtin-structured-output";
    const preset = {
      name: "结构化输出",
      description: "引导用 chart/metric/table 代码块展示结构化数据",
      systemPrompt: BUILTIN_STRUCTURED_OUTPUT_PROMPT,
      icon: "BarChart3",
      sortOrder: 100,
    };
    const [existing] = await db.select({ id: t.id }).from(t).where(eq(t.id, id)).limit(1);
    if (existing) {
      await db
        .update(t)
        .set({
          name: preset.name,
          description: preset.description,
          systemPrompt: preset.systemPrompt,
          icon: preset.icon,
          sortOrder: preset.sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(t.id, id));
    } else {
      await db.insert(t).values({
        id,
        name: preset.name,
        description: preset.description,
        systemPrompt: preset.systemPrompt,
        icon: preset.icon,
        enabled: true,
        sortOrder: preset.sortOrder,
      });
    }
    console.log("[bootstrap] ✅ 内置输出模式预设就绪(结构化输出)");
  } catch (e) {
    console.warn("[bootstrap] 内置输出模式预设写入失败(忽略):", e instanceof Error ? e.message : e);
  }
}

/**
 * 清理「生成中」僵尸标记。
 *
 * generating 标记由 /api/chat 在流式开始时置 true、结束时置 false。
 * 若进程在流式中途崩溃,该标记会残留,导致侧栏永久转圈。
 * 启动时把所有 generating=true 的会话重置为 false(尽力而为,失败不阻断启动)。
 */
async function clearStaleGenerating(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
): Promise<void> {
  try {
    const { eq } = await import("drizzle-orm");
    const conversations = schema.conversations;
    await db.update(conversations).set({ generating: false }).where(eq(conversations.generating, true));
    console.log("[bootstrap] ✅ 已重置残留的 generating 标记");
  } catch (e) {
    console.warn(
      "[bootstrap] 清理 generating 标记失败(忽略):",
      e instanceof Error ? e.message : e,
    );
  }
}

// 内置「纸面杂志」样式:杂志感米色纸面 + 红色标题色条 + Mac 圆点代码块 + 高级组件。
// 配合 custom 渲染器(parseMarkdown)使用。同时作为「输出样式」模板范本:新建皮肤时
// 复制本预设,改 cssClass 前缀(rs-paper→rs-xxx)与本 CSS 的 --pp-* 变量即可。
const BUILTIN_PAPER_CSS = `
:where(.rs-paper) {
  /* 底色与纸面 */
  --pp-bg: #f4f3ef;
  --pp-paper: #ffffff;
  --pp-soft: #fdfdfc;
  --pp-line: #e8ded1;
  /* 文字层级(text 最深 → body 正文 → secondary 次级 → muted 辅助) */
  --pp-text: #161616;
  --pp-body: #2a2a2a;
  --pp-secondary: #333333;
  --pp-muted: #5f6368;
  --pp-strong: #111111;
  --pp-accent: #111111;
  /* 代码 */
  --pp-code-bg: #f1f1f1;
  --pp-pre-bg: #161616;
  --pp-pre-text: #f6f6f6;
  /* 表格 */
  --pp-table-head-bg: #111111;
  /* 强调色 */
  --pp-danger: #9b1c1c;
  --pp-brand-red: #cc2222;
}
.rs-paper .nekusora-md {
  color: var(--pp-text);
  font-size: 16px;
  line-height: 1.95;
  word-break: break-word;
  -webkit-font-smoothing: antialiased;
}
.rs-paper .nekusora-md > *:first-child { margin-top: 0 !important; }
.rs-paper .nekusora-md > *:last-child { margin-bottom: 0 !important; }

/* 标题 */
.rs-paper .nekusora-md :is(h1, h2, h3, h4) {
  color: var(--pp-strong);
  line-height: 1.4;
  letter-spacing: -0.02em;
}
.rs-paper .nekusora-md h1 { margin: 0 0 28px; font-size: 32px; font-weight: 900; }
.rs-paper .nekusora-md h2 {
  position: relative;
  margin: 48px 0 22px;
  padding-left: 18px;
  font-size: 25px;
  font-weight: 900;
}
.rs-paper .nekusora-md h2::before {
  content: "";
  position: absolute;
  left: 0;
  top: 6px;
  width: 5px;
  height: 26px;
  border-radius: 999px;
  background: var(--pp-brand-red);
}
.rs-paper .nekusora-md h3 { margin: 38px 0 16px; font-size: 21px; font-weight: 850; }
.rs-paper .nekusora-md h4 { margin: 28px 0 12px; font-size: 18px; font-weight: 850; }

/* 正文与强调 */
.rs-paper .nekusora-md p { margin: 18px 0; color: var(--pp-body); }
.rs-paper .nekusora-md strong {
  font-weight: 850;
  color: var(--pp-strong);
  background: linear-gradient(transparent 62%, rgba(255, 221, 105, 0.48) 0);
  padding: 0 3px;
}
.rs-paper .nekusora-md em { font-style: normal; color: var(--pp-strong); font-weight: 700; }

/* 引用块 */
.rs-paper .nekusora-md blockquote {
  margin: 32px 0;
  padding: 20px 24px;
  border-radius: 4px 16px 16px 4px;
  background: var(--pp-soft);
  border: 1px solid var(--pp-line);
  border-left: 5px solid var(--pp-brand-red);
  color: var(--pp-secondary);
}
.rs-paper .nekusora-md blockquote p { margin: 0; font-style: italic; }

/* 列表 */
.rs-paper .nekusora-md ul { margin: 18px 0; padding-left: 1.45em; list-style: disc; }
.rs-paper .nekusora-md ol { margin: 18px 0; padding-left: 1.45em; list-style: decimal; }
.rs-paper .nekusora-md li { margin: 10px 0; color: var(--pp-secondary); }
.rs-paper .nekusora-md li::marker { color: var(--pp-brand-red); }
.rs-paper .nekusora-md hr { border: 0; height: 1px; background: var(--pp-line); margin: 38px 0; }

/* 行内代码与代码块(Mac 圆点) */
.rs-paper .nekusora-md code {
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--pp-code-bg);
  font-size: 0.9em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.rs-paper .nekusora-md pre {
  position: relative;
  margin: 28px 0;
  padding: 40px 20px 18px;
  border-radius: 16px;
  overflow-x: auto;
  background: var(--pp-pre-bg);
  color: var(--pp-pre-text);
  line-height: 1.7;
  box-shadow: inset 0 1px 4px rgba(0,0,0,0.2);
}
.rs-paper .nekusora-md pre::before {
  content: "";
  position: absolute;
  top: 16px;
  left: 18px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #ff5f56;
  box-shadow: 15px 0 0 #ffbd2e, 30px 0 0 #27c93f;
}
.rs-paper .nekusora-md pre code { padding: 0; background: transparent; color: inherit; }

/* 链接 */
.rs-paper .nekusora-md a {
  color: var(--pp-strong);
  font-weight: 700;
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

/* ===== 高级新媒体组件(金句、卡片栅格、表格) ===== */
.rs-paper .nekusora-md .takeaway {
  margin: 36px 0;
  padding: 26px 28px;
  border-radius: 18px;
  background: linear-gradient(135deg, #161616, #221f1a);
  border: 1px solid rgba(255, 221, 105, 0.12);
  color: #f4f3ef;
  font-size: 18.5px;
  line-height: 1.85;
  font-weight: 800;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.12);
  position: relative;
}
.rs-paper .nekusora-md .takeaway::before {
  content: "\\201C";
  position: absolute;
  top: -6px;
  left: 20px;
  font-size: 52px;
  color: rgba(255, 221, 105, 0.25);
  font-family: Georgia, serif;
}
.rs-paper .nekusora-md .note-box {
  margin: 26px 0;
  padding: 18px 20px;
  border-radius: 16px;
  background: var(--pp-soft);
  border: 1px solid var(--pp-line);
  color: var(--pp-secondary);
}
.rs-paper .nekusora-md :is(.card-grid, .summary-grid, .opinion-grid) {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  margin: 34px 0;
  align-items: stretch;
}
.rs-paper .nekusora-md :is(.card-grid, .summary-grid, .opinion-grid) > * {
  margin-top: 0 !important;
  transform: none !important;
  align-self: stretch;
}
.rs-paper .nekusora-md :is(.card, .summary-card, .opinion-card) {
  height: 100%;
  padding: 24px 22px 26px;
  border-radius: 18px;
  border: 1px solid var(--pp-line);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(255, 253, 248, 0.98));
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.03);
  transition: all 0.35s cubic-bezier(0.25, 0.8, 0.25, 1);
}
.rs-paper .nekusora-md :is(.card, .summary-card, .opinion-card):hover {
  transform: translateY(-5px);
  box-shadow: 0 20px 45px rgba(0, 0, 0, 0.08);
  border-color: var(--pp-brand-red);
}
.rs-paper .nekusora-md :is(.card-title, .summary-title, .opinion-label) {
  margin-bottom: 12px;
  font-size: 17px;
  line-height: 1.45;
  font-weight: 900;
  color: var(--pp-strong);
}
.rs-paper .nekusora-md :is(.card, .summary-card, .opinion-card) p,
.rs-paper .nekusora-md :is(.card-text, .summary-text) {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.85;
  color: var(--pp-muted);
  font-weight: 600;
}
.rs-paper .nekusora-md .opinion-card { position: relative; border-left: 6px solid var(--pp-accent); }
.rs-paper .nekusora-md .opinion-card.fan { border-left-color: var(--pp-accent); }
.rs-paper .nekusora-md .opinion-card.public { border-left-color: #777; }
.rs-paper .nekusora-md :is(.opinion-card.anti, .opinion-card.danger) { border-left-color: var(--pp-danger); }
.rs-paper .nekusora-md :is(.card-grid, .summary-grid, .opinion-grid).is-staggered > *:nth-child(3n + 2) {
  transform: translateY(44px) !important;
}
.rs-paper .nekusora-md :is(.card-grid, .summary-grid, .opinion-grid).is-staggered > *:nth-child(3n + 2):hover {
  transform: translateY(39px) !important;
}
.rs-paper .nekusora-md :is(.card-grid, .summary-grid, .opinion-grid).is-staggered { margin-bottom: 76px; }

/* 表格 */
.rs-paper .nekusora-md .compare-table-wrap {
  margin: 34px 0;
  overflow-x: auto;
  border: 1px solid var(--pp-line);
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 16px 38px rgba(0, 0, 0, 0.03);
}
.rs-paper .nekusora-md :is(table, .compare-table) {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  font-size: 15px;
  line-height: 1.75;
}
.rs-paper .nekusora-md :is(th, .compare-table th) {
  padding: 16px;
  background: var(--pp-table-head-bg);
  color: #fff;
  text-align: left;
  font-weight: 850;
  white-space: nowrap;
  letter-spacing: 0.5px;
}
.rs-paper .nekusora-md :is(td, .compare-table td) {
  padding: 18px 16px;
  border-top: 1px solid var(--pp-line);
  color: var(--pp-secondary);
  vertical-align: top;
}
.rs-paper .nekusora-md tbody tr:nth-child(even) { background-color: var(--pp-soft); }
.rs-paper .nekusora-md :is(td, .compare-table td):first-child {
  font-weight: 850;
  color: var(--pp-strong);
  white-space: nowrap;
}

/* 响应式 */
@media (max-width: 768px) {
  .rs-paper .nekusora-md { font-size: 15px; line-height: 1.85; }
  .rs-paper .nekusora-md h2 { margin-top: 38px; font-size: 23px; }
  .rs-paper .nekusora-md h3 { font-size: 19px; }
  .rs-paper .nekusora-md :is(.card-grid, .summary-grid, .opinion-grid) { grid-template-columns: 1fr !important; gap: 16px !important; }
  .rs-paper .nekusora-md :is(.card-grid, .summary-grid, .opinion-grid).is-staggered > * { transform: none !important; }
  .rs-paper .nekusora-md :is(.card-grid, .summary-grid, .opinion-grid).is-staggered { margin-bottom: 24px; }
  .rs-paper .nekusora-md :is(.card, .summary-card, .opinion-card) { padding: 20px 18px; }
}
`;
