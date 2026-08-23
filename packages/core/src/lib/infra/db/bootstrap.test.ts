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
  "gateway_governance_operation",
  "gateway_quota_kind",
  "message_status",
  "model_visibility",
  "provider_protocol",
  "route_api_format",
];

const PG_BASELINE_TABLES = [
  "account",
  "api_keys",
  "artifacts",
  "context_snapshots",
  "conversation_projects",
  "conversation_shares",
  "conversation_share_unlock_attempts",
  "conversation_title_jobs",
  "conversations",
  "file_chunks",
  "file_objects",
  "gateway_attempts",
  "gateway_executions",
  "gateway_governance_leases",
  "gateway_governance_hourly",
  "gateway_governance_subjects",
  "gateway_quota_windows",
  "gateway_retention_state",
  "image_jobs",
  "instruction_cards",
  "key_model_bindings",
  "knowledge_bases",
  "mcp_servers",
  "memory_extraction_jobs",
  "message_feedback",
  "message_file_objects",
  "messages",
  "model_catalog",
  "models",
  "output_modes",
  "prompt_templates",
  "providers",
  "render_styles",
  "routes",
  "runs",
  "session",
  "settings_change_sets",
  "settings_control_state",
  "system_settings",
  "tool_calls",
  "user",
  "user_settings",
  "verification",
];

const PG_BASELINE_REQUIRED_COLUMNS = [
  "runs.lease_expires_at",
  "runs.duration_ms",
  "runs.completed_at",
  "tool_calls.status",
  "tool_calls.input_json",
  "tool_calls.output_json",
  "tool_calls.error_json",
];

const TEST_MIGRATION_HASHES = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
const PRE_SQUASH_MIGRATION_HASHES = [
  "3fec68fc777efd40898da6d0bc06fd658a8f0b7ebd8fe9cba8f3949424f5c252",
  "f12dd70266b6ceed7aaa682f1007984e253fd9682b73b1c1a446165fe790a158",
  "8a5e3b1c0b7b93319ef2ce17f0444379735a1f88eb87b031ef37b7485e7fc2ea",
  "11822ee2598955603dac2afb72148542dd33d2fd8126872d0663d26cbb5655be",
  "b09659d07d49d91a034f902965771d263b70c2d6196f7c6464acd4eb75f8bb2c",
  "e418a6c0e4c67ea0392fb3291e909c79b5b43d25defef4152f744178f0884863",
  "85feece5022887c83d202dee31ebc2ef10ede80f8350e313fd3c76ad7e3ba163",
  "ee029092d549358b511669c2805024b89435c159d9be25e813fcf90939bce3ed",
  "493ef64e2419c54d8b88680956244232bc7f080d713ac3d54afa461ab1ba3d00",
  "3df3c6dae51c3ce6bceed319134332b43d40c80b386b8b3d1c9b8338f01eedbc",
  "0a5a8d441b339aeaa6ab580d3b73935922b6c840cf4df63f90d7caf8d7aeaaf2",
  "92b0e218fb7a2d7b7f9f2af612c1d061b1550f781fa1cdbfbad8526954a80567",
  "b215370eecea0e4c0aaf8b6147750b2aca9d559d8d8f03dedd7b9c30551f4975",
  "37c25fbb9ee852721b1a068a97abf7196fcd1c17526f035a40794dd78b1c22db",
  "2a7be65eff84ae31a0f62d77615318665c80b6d9a149df87f036e9ad4ebd663a",
  "181e5a0921b270020da8780a76481eea7c17873317d9877952ef1f52ed8810e1",
];
const SQUASHED_BASELINE_HASH = "f".repeat(64);

function mockSquashedBaselineMigrationFile() {
  vi.doMock("drizzle-orm/migrator", () => ({
    readMigrationFiles: () => [{ hash: SQUASHED_BASELINE_HASH, folderMillis: 100 }],
  }));
}

function preSquashLedger() {
  const ledger = PRE_SQUASH_MIGRATION_HASHES.map((hash, index) => ({
    id: index + 1,
    hash,
    created_at: (index + 1) * 100,
  }));
  [ledger[8].id, ledger[9].id] = [ledger[9].id, ledger[8].id];
  return ledger.sort((left, right) => left.id - right.id);
}

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
  mutationResult: unknown | ((text: string) => unknown) = { rows: [], rowCount: 1 },
  options: PooledMigrationDbOptions = {},
) {
  const latest = [...ledger].sort((left, right) => right.created_at - left.created_at)[0];
  return pooledMigrationDb((text) => {
    if (text.includes("order by created_at desc limit 1")) {
      return { rows: latest ? [latest] : [] };
    }
    if (text.includes("order by id")) return { rows: ledger };
    if (
      text.startsWith("update drizzle.__drizzle_migrations")
      || text.startsWith("delete from drizzle.__drizzle_migrations")
    ) {
      return typeof mutationResult === "function" ? mutationResult(text) : mutationResult;
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

  it("非 Web 进程显式跳过首管理员 seed", async () => {
    process.env.BOOTSTRAP_SKIP_MIGRATE = "1";
    process.env.NODE_ENV = "production";
    delete process.env.SEED_ADMIN_PASSWORD;
    const getAuth = vi.fn();
    vi.doMock("@/lib/infra/db", () => ({
      getDb: vi.fn().mockResolvedValue({
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      }),
      getSchema: vi.fn(() => ({})),
    }));
    vi.doMock("@/auth", () => ({ getAuth }));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { bootstrapDatabase } = await import("@/lib/infra/db/bootstrap");
      await expect(bootstrapDatabase({ seedAdmin: false })).resolves.toBeUndefined();
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }

    expect(getAuth).not.toHaveBeenCalled();
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
    expect(client.release).toHaveBeenCalledWith(true);
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
    expect(client.release).toHaveBeenCalledWith(true);
    expect(migrate).not.toHaveBeenCalled();
  });

  it("完整旧迁移链自动归并为当前单基线账本", async () => {
      const baselineHash = PRE_SQUASH_MIGRATION_HASHES[0];
      mockSquashedBaselineMigrationFile();
      const migrate = vi.fn(async () => undefined);
      vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
      const ledger = preSquashLedger();
      ledger[0].hash = baselineHash;
      const { db, executedSql } = migrationLedgerDb(ledger, (text) => ({
        rows: [],
        rowCount: text.startsWith("delete from") ? 15 : 1,
      }));
      const trailingIds = [...ledger]
        .sort((left, right) => left.created_at - right.created_at)
        .slice(1)
        .map((row) => row.id)
        .join(", ");
      const { runMigrations } = await import("@/lib/infra/db/bootstrap");

      await expect(runMigrations(db)).resolves.toBeUndefined();
      expect(executedSql).toContain(
        `update drizzle.__drizzle_migrations set hash = '${SQUASHED_BASELINE_HASH}', ` +
          `created_at = 100 where id = 1 and hash = '${baselineHash}' ` +
          `and created_at = 100`,
      );
      expect(executedSql).toContain(
        `delete from drizzle.__drizzle_migrations where id in (${trailingIds})`,
      );
      expect(migrate).toHaveBeenCalledWith(db, { migrationsFolder: "drizzle/pg" });
  });

  it("旧迁移链任一 hash 不匹配时拒绝归并", async () => {
    mockSquashedBaselineMigrationFile();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const ledger = preSquashLedger();
    ledger[10].hash = "e".repeat(64);
    const { db, executedSql } = migrationLedgerDb(ledger);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("迁移账本 hash 与 journal 不一致:index=0");
    expect(executedSql.some((text) => text.startsWith("delete from"))).toBe(false);
    expect(migrate).not.toHaveBeenCalled();
  });

  it("完整旧迁移链归并行数异常时阻断迁移", async () => {
    mockSquashedBaselineMigrationFile();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db } = migrationLedgerDb(preSquashLedger(), (text) => ({
      rows: [],
      rowCount: text.startsWith("delete from") ? 14 : 1,
    }));
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("旧迁移账本尾部归并失败");
    expect(migrate).not.toHaveBeenCalled();
  });

  it("只有旧 baseline hash 时拒绝兼容", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db, executedSql } = migrationLedgerDb([
      { id: 1, hash: PRE_SQUASH_MIGRATION_HASHES[0], created_at: 100 },
    ]);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("迁移账本 hash 与 journal 不一致:index=0");
    expect(executedSql.some((text) => text.startsWith("update drizzle.__drizzle_migrations"))).toBe(false);
    expect(migrate).not.toHaveBeenCalled();
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
    const { db, client, executedSql } = migrationLedgerDb([]);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).resolves.toBeUndefined();
    expect(executedSql.some((text) => text.startsWith("update drizzle.__drizzle_migrations"))).toBe(false);
    expect(migrate).toHaveBeenCalledWith(db, { migrationsFolder: "drizzle/pg" });
    expect(client.release).toHaveBeenCalledWith(true);
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

  it("Drizzle migrate 失败时先解锁再销毁迁移连接", async () => {
    mockTestMigrationFiles();
    const migrate = vi.fn(async () => {
      throw new Error("migrate failed");
    });
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { db, client, executedSql } = migrationLedgerDb([]);
    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow("migrate failed");
    expect(executedSql.some((text) => text.includes("pg_advisory_unlock"))).toBe(true);
    expect(client.release).toHaveBeenCalledWith(true);
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
      if (text.includes("from information_schema.columns")) {
        return { rows: PG_BASELINE_REQUIRED_COLUMNS.map((name) => ({ name })) };
      }
      return { rows: [] };
    });

    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).resolves.toBeUndefined();

    expect(executedSql.some((text) => text.includes('insert into drizzle.__drizzle_migrations'))).toBe(true);
    expect(migrate).toHaveBeenCalledWith(db, { migrationsFolder: "drizzle/pg" });
  });

  it("PG 基线表齐全但关键列缺失时拒绝自动收养", async () => {
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
        return { rows: PG_BASELINE_TABLES.map((name) => ({ name })) };
      }
      if (text.includes("from information_schema.columns")) {
        return {
          rows: PG_BASELINE_REQUIRED_COLUMNS
            .filter((name) => name !== "tool_calls.output_json")
            .map((name) => ({ name })),
        };
      }
      return { rows: [] };
    });

    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db)).rejects.toThrow(
      "PG 基线表存在但关键列不完整",
    );
    expect(migrate).not.toHaveBeenCalled();
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
