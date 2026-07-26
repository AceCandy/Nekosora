import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_BACKUP = { ...process.env };

afterEach(async () => {
  try {
    const { closeDb } = await import("@/lib/infra/db");
    await closeDb();
  } catch {
    // 测试可能在 db 模块导入前失败,此时无需关闭连接。
  }
  vi.resetModules();
  vi.doUnmock("drizzle-orm/node-postgres");
  vi.doUnmock("drizzle-orm/node-postgres/migrator");
  vi.doUnmock("drizzle-orm/migrator");
  process.env = { ...ENV_BACKUP };
});

const PG_BASELINE_TYPES = [
  "api_key_kind",
  "message_status",
  "model_visibility",
  "provider_protocol",
];

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
  "image_jobs",
  "instruction_cards",
  "key_model_bindings",
  "knowledge_bases",
  "mcp_servers",
  "messages",
  "models",
  "output_modes",
  "prompt_templates",
  "providers",
  "render_styles",
  "routes",
  "runs",
  "session",
  "system_settings",
  "tool_calls",
  "usage_logs",
  "user",
  "user_settings",
  "verification",
];

const TEST_MIGRATION_HASHES = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
const LEGACY_BASELINE_HASH = "0f852461b32b9e206d15e4229ea861c7143efe9b220e341d3bcb0dcee8f6511c";

function mockTestMigrationFiles() {
  vi.doMock("drizzle-orm/migrator", () => ({
    readMigrationFiles: () => [
      { hash: TEST_MIGRATION_HASHES[0], folderMillis: 100 },
      { hash: TEST_MIGRATION_HASHES[1], folderMillis: 200 },
      { hash: TEST_MIGRATION_HASHES[2], folderMillis: 300 },
    ],
  }));
}

interface PooledMigrationDbOptions {
  drizzleError?: Error;
  lockError?: Error;
  unlockError?: Error;
  unlockResult?: unknown;
}

function pooledMigrationDb(
  handler: (text: string) => unknown | Promise<unknown>,
  options: PooledMigrationDbOptions = {},
) {
  const executedSql: string[] = [];
  const migrationDb = {
    execute: vi.fn(async (query: unknown) => {
      const text = String(query);
      executedSql.push(text);
      if (text.includes("pg_advisory_unlock")) {
        if (options.unlockError) throw options.unlockError;
        return options.unlockResult ?? { rows: [{ unlocked: true }] };
      }
      if (text.includes("pg_advisory_lock")) {
        if (options.lockError) throw options.lockError;
        return { rows: [] };
      }
      return handler(text);
    }),
    transaction: vi.fn(),
  };
  migrationDb.transaction.mockImplementation(
    async (callback: (tx: typeof migrationDb) => Promise<unknown>) => callback(migrationDb),
  );

  const client = { release: vi.fn() };
  const db = Object.assign(migrationDb, {
    $client: { connect: vi.fn(async () => client) },
  });
  vi.doMock("drizzle-orm/node-postgres", () => {
    return {
      drizzle: () => {
        if (options.drizzleError) throw options.drizzleError;
        return db;
      },
    };
  });
  return { db, client, executedSql };
}

function migrationLedgerDb(
  ledger: Array<{ id: number; hash: string; created_at: number }>,
  updateResult: unknown = { rows: [], rowCount: 1 },
  options: PooledMigrationDbOptions = {},
) {
  const latest = [...ledger].sort((left, right) => right.created_at - left.created_at)[0];
  return pooledMigrationDb((text) => {
    if (text.includes("order by created_at desc limit 1")) {
      return { rows: latest ? [latest] : [] };
    }
    if (text.includes("order by id")) return { rows: ledger };
    if (text.startsWith("update drizzle.__drizzle_migrations")) {
      return updateResult;
    }
    return { rows: [] };
  }, options);
}

describe("bootstrapDatabase", () => {
  it("生产环境已有用户时跳过 seed 凭据要求且不全量更新生成状态", async () => {
    process.env.BOOTSTRAP_SKIP_MIGRATE = "1";
    process.env.NODE_ENV = "production";
    delete process.env.SEED_ADMIN_PASSWORD;
    const schema = {
      user: { id: "user.id", email: "user.email" },
      renderStyles: {
        id: "renderStyles.id",
        cssClass: "renderStyles.cssClass",
        builtin: "renderStyles.builtin",
      },
      outputModes: { id: "outputModes.id" },
      conversations: { generating: "conversations.generating" },
    };
    const resultSets = [
      [{ id: "user-1" }],
      [{ id: "paper" }],
      [{ id: "paper", cssClass: "paper" }],
      [{ id: "builtin-structured-output" }],
    ];
    const select = vi.fn(() => {
      const rows = resultSets.shift() ?? [];
      const query = {
        from: vi.fn(() => query),
        where: vi.fn(() => query),
        limit: vi.fn(() => Promise.resolve(rows.slice(0, 1))),
        then: (
          resolve: (value: Record<string, unknown>[]) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      return query;
    });
    const updatedTables: unknown[] = [];
    const update = vi.fn((table: unknown) => {
      updatedTables.push(table);
      return {
        set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      };
    });
    const db = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      select,
      update,
      insert: vi.fn(),
      delete: vi.fn(),
    };
    vi.doMock("@/lib/infra/db", () => ({
      getDb: vi.fn().mockResolvedValue(db),
      getSchema: vi.fn(() => schema),
    }));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const { bootstrapDatabase } = await import("@/lib/infra/db/bootstrap");
      await bootstrapDatabase();
    } finally {
      logSpy.mockRestore();
    }

    expect(updatedTables).not.toContain(schema.conversations);
  });
});

describe("runMigrations", () => {
  it("相同迁移 hash 已按旧时间登记时协调到当前 journal 时间", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));

    const ledger = [
      { id: 1, hash: TEST_MIGRATION_HASHES[0], created_at: 100 },
      { id: 2, hash: TEST_MIGRATION_HASHES[1], created_at: 200 },
      { id: 3, hash: TEST_MIGRATION_HASHES[2], created_at: 250 },
    ];
    const { db, client, executedSql } = migrationLedgerDb(ledger);

    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).resolves.toBeUndefined();
    expect(executedSql).toContain(
      `update drizzle.__drizzle_migrations as target set created_at = 300 ` +
        `where target.id = 3 and target.hash = '${TEST_MIGRATION_HASHES[2]}' ` +
        `and target.created_at = 250 and not exists (` +
        `select 1 from drizzle.__drizzle_migrations as occupied where occupied.created_at = 300)`,
    );
    expect(executedSql.some((text) => text.includes("pg_advisory_lock"))).toBe(true);
    expect(executedSql).toContain(
      "lock table drizzle.__drizzle_migrations in share row exclusive mode",
    );
    expect(executedSql.some((text) => text.includes("pg_advisory_unlock"))).toBe(true);
    expect(client.release).toHaveBeenCalledWith(false);
    expect(migrate).toHaveBeenCalledWith(db, { migrationsFolder: "drizzle/pg" });
  });

  it("前序迁移缺失但后续 hash 已登记时拒绝协调", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db, executedSql } = migrationLedgerDb([
      { id: 1, hash: TEST_MIGRATION_HASHES[0], created_at: 100 },
      { id: 3, hash: TEST_MIGRATION_HASHES[2], created_at: 250 },
    ]);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("迁移账本存在断层:index=1");
    expect(executedSql.some((text) => text.startsWith("update drizzle.__drizzle_migrations"))).toBe(false);
    expect(migrate).not.toHaveBeenCalled();
  });

  it("canonical 时间被错误 hash 占用时拒绝协调", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db, executedSql } = migrationLedgerDb([
      { id: 1, hash: TEST_MIGRATION_HASHES[0], created_at: 100 },
      { id: 2, hash: "d".repeat(64), created_at: 200 },
    ]);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("迁移账本 hash 与 journal 不一致:index=1");
    expect(executedSql.some((text) => text.startsWith("update drizzle.__drizzle_migrations"))).toBe(false);
    expect(migrate).not.toHaveBeenCalled();
  });

  it("baseline canonical 时间被未知历史 hash 占用时拒绝协调", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db, client, executedSql } = migrationLedgerDb([
      { id: 1, hash: "d".repeat(64), created_at: 100 },
    ]);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("迁移账本 hash 与 journal 不一致:index=0");
    expect(executedSql.some((text) => text.startsWith("update drizzle.__drizzle_migrations"))).toBe(false);
    expect(executedSql.some((text) => text.includes("pg_advisory_unlock"))).toBe(true);
    expect(client.release).toHaveBeenCalledWith(false);
    expect(migrate).not.toHaveBeenCalled();
  });

  it("baseline canonical 时间上的已知旧 hash 保持兼容", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db, executedSql } = migrationLedgerDb([
      { id: 1, hash: LEGACY_BASELINE_HASH, created_at: 100 },
    ]);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).resolves.toBeUndefined();
    expect(executedSql.some((text) => text.startsWith("update drizzle.__drizzle_migrations"))).toBe(false);
    expect(migrate).toHaveBeenCalledWith(db, { migrationsFolder: "drizzle/pg" });
  });

  it("账本协调 UPDATE 缺少明确 rowCount 时拒绝继续迁移", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db } = migrationLedgerDb([
      { id: 1, hash: TEST_MIGRATION_HASHES[0], created_at: 100 },
      { id: 2, hash: TEST_MIGRATION_HASHES[1], created_at: 200 },
      { id: 3, hash: TEST_MIGRATION_HASHES[2], created_at: 250 },
    ], { rows: [] });
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("迁移账本并发变化,协调失败");
    expect(migrate).not.toHaveBeenCalled();
  });

  it("账本协调 UPDATE 未命中时按并发变化失败关闭", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db } = migrationLedgerDb([
      { id: 1, hash: TEST_MIGRATION_HASHES[0], created_at: 100 },
      { id: 2, hash: TEST_MIGRATION_HASHES[1], created_at: 200 },
      { id: 3, hash: TEST_MIGRATION_HASHES[2], created_at: 250 },
    ], { rows: [], rowCount: 0 });
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("迁移账本并发变化,协调失败");
    expect(migrate).not.toHaveBeenCalled();
  });

  it("空账本也校验 journal 时间严格递增", async () => {
    vi.doMock("drizzle-orm/migrator", () => ({
      readMigrationFiles: () => [
        { hash: TEST_MIGRATION_HASHES[0], folderMillis: 200 },
        { hash: TEST_MIGRATION_HASHES[1], folderMillis: 100 },
      ],
    }));
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db } = migrationLedgerDb([]);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("迁移 journal 时间必须严格递增:index=1");
    expect(migrate).not.toHaveBeenCalled();
  });

  it("journal hash 重复时阻断空账本迁移", async () => {
    vi.doMock("drizzle-orm/migrator", () => ({
      readMigrationFiles: () => [
        { hash: TEST_MIGRATION_HASHES[0], folderMillis: 100 },
        { hash: TEST_MIGRATION_HASHES[0], folderMillis: 200 },
      ],
    }));
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db } = migrationLedgerDb([]);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("迁移 journal 存在重复 hash");
    expect(migrate).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "id",
      ledger: [
        { id: 1, hash: TEST_MIGRATION_HASHES[0], created_at: 100 },
        { id: 1, hash: TEST_MIGRATION_HASHES[1], created_at: 200 },
      ],
      message: "迁移账本存在重复 id",
    },
    {
      name: "created_at",
      ledger: [
        { id: 1, hash: TEST_MIGRATION_HASHES[0], created_at: 100 },
        { id: 2, hash: TEST_MIGRATION_HASHES[1], created_at: 100 },
      ],
      message: "迁移账本存在重复 created_at",
    },
    {
      name: "hash",
      ledger: [
        { id: 1, hash: TEST_MIGRATION_HASHES[0], created_at: 100 },
        { id: 2, hash: TEST_MIGRATION_HASHES[0], created_at: 200 },
      ],
      message: "迁移账本存在重复 hash",
    },
  ])("账本 $name 重复时阻断迁移", async ({ ledger, message }) => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db } = migrationLedgerDb(ledger);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow(message);
    expect(migrate).not.toHaveBeenCalled();
  });

  it("旧迁移时间占用另一 canonical 时间时拒绝协调", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db } = migrationLedgerDb([
      { id: 1, hash: TEST_MIGRATION_HASHES[0], created_at: 100 },
      { id: 2, hash: TEST_MIGRATION_HASHES[1], created_at: 300 },
    ]);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("迁移旧时间占用当前 journal:index=1");
    expect(migrate).not.toHaveBeenCalled();
  });

  it("未知额外账本记录存在时拒绝自动协调", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db, executedSql } = migrationLedgerDb([
      { id: 1, hash: TEST_MIGRATION_HASHES[0], created_at: 100 },
      { id: 2, hash: TEST_MIGRATION_HASHES[1], created_at: 200 },
      { id: 9, hash: "e".repeat(64), created_at: 250 },
    ]);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("迁移账本存在未知记录");
    expect(executedSql.some((text) => text.startsWith("update drizzle.__drizzle_migrations"))).toBe(false);
    expect(migrate).not.toHaveBeenCalled();
  });

  it("正常连续迁移前缀不改写账本", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db, executedSql } = migrationLedgerDb([
      { id: 1, hash: TEST_MIGRATION_HASHES[0], created_at: 100 },
      { id: 2, hash: TEST_MIGRATION_HASHES[1], created_at: 200 },
    ]);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).resolves.toBeUndefined();
    expect(executedSql.some((text) => text.startsWith("update drizzle.__drizzle_migrations"))).toBe(false);
    expect(migrate).toHaveBeenCalledWith(db, { migrationsFolder: "drizzle/pg" });
  });

  it("正常空账本不协调并继续执行迁移", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db, executedSql } = migrationLedgerDb([]);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).resolves.toBeUndefined();
    expect(executedSql.some((text) => text.startsWith("update drizzle.__drizzle_migrations"))).toBe(false);
    expect(migrate).toHaveBeenCalledWith(db, { migrationsFolder: "drizzle/pg" });
  });

  it("迁移连接包装失败时仍归还连接", async () => {
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db, client } = pooledMigrationDb(
      () => ({ rows: [] }),
      { drizzleError: new Error("driver setup failed") },
    );
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("driver setup failed");
    expect(client.release).toHaveBeenCalledWith(false);
    expect(migrate).not.toHaveBeenCalled();
  });

  it("迁移锁获取失败时销毁连接", async () => {
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db, client, executedSql } = pooledMigrationDb(
      () => ({ rows: [] }),
      { lockError: new Error("lock failed") },
    );
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("lock failed");
    expect(executedSql.some((text) => text.includes("pg_advisory_unlock"))).toBe(false);
    expect(client.release).toHaveBeenCalledWith(true);
    expect(migrate).not.toHaveBeenCalled();
  });

  it("Drizzle migrate 失败时先解锁再归还连接", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => {
      throw new Error("migrate failed");
    });
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db, client, executedSql } = migrationLedgerDb([]);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("migrate failed");
    expect(executedSql.some((text) => text.includes("pg_advisory_unlock"))).toBe(true);
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it("迁移锁无法确认释放时销毁连接并阻断启动", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db, client } = migrationLedgerDb(
      [],
      undefined,
      { unlockResult: { rows: [{ unlocked: false }] } },
    );
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("迁移锁释放失败");
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it("迁移锁释放查询失败时销毁连接并阻断启动", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db, client } = migrationLedgerDb(
      [],
      undefined,
      { unlockError: new Error("unlock query failed") },
    );
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("unlock query failed");
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it("PG 已有完整基线 schema 但缺迁移记录时补写 Drizzle 记录", async () => {
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));

    const { db, executedSql } = pooledMigrationDb((text) => {
      if (text.includes("from drizzle.__drizzle_migrations")) {
        return { rows: [] };
      }
      if (text.includes("from pg_type")) {
        return { rows: PG_BASELINE_TYPES.map((name) => ({ name })) };
      }
      if (text.includes("from pg_tables")) {
        return { rows: PG_BASELINE_TABLES.map((name) => ({ name })) };
      }
      return { rows: [] };
    });

    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).resolves.toBeUndefined();

    expect(executedSql.some((text) => text.includes('insert into drizzle.__drizzle_migrations'))).toBe(true);
    expect(migrate).toHaveBeenCalledWith(db, { migrationsFolder: "drizzle/pg" });
  });

  it("PG 只有 enum 残留时继续执行幂等基线迁移", async () => {
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));

    const { db } = pooledMigrationDb((text) => {
      if (text.includes("from drizzle.__drizzle_migrations")) {
        return { rows: [] };
      }
      if (text.includes("from pg_type")) {
        return { rows: [{ name: "access_scope" }] };
      }
      if (text.includes("from pg_tables")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).resolves.toBeUndefined();
    expect(migrate).toHaveBeenCalledWith(db, { migrationsFolder: "drizzle/pg" });
  });

  it("PG 只有部分基线表时拒绝自动收养", async () => {
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));

    const { db } = pooledMigrationDb((text) => {
      if (text.includes("from drizzle.__drizzle_migrations")) {
        return { rows: [] };
      }
      if (text.includes("from pg_type")) {
        return { rows: PG_BASELINE_TYPES.map((name) => ({ name })) };
      }
      if (text.includes("from pg_tables")) {
        return { rows: [{ name: "account" }] };
      }
      return { rows: [] };
    });

    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("PG 已存在部分基线对象但没有 Drizzle 迁移记录");
    expect(migrate).not.toHaveBeenCalled();
  });
});
