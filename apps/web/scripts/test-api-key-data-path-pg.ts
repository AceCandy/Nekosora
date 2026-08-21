import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DATABASE_PREFIX = "nekusora_api_key_data_test_";

function quoteDatabaseName(name: string): string {
  if (!new RegExp(`^${DATABASE_PREFIX}[0-9a-f]{16}$`).test(name)) {
    throw new Error("拒绝操作非 API Key 数据路径测试数据库");
  }
  return `"${name}"`;
}

function runPnpm(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`pnpm ${args.join(" ")} failed (${signal ?? code ?? "unknown"})`));
    });
  });
}

async function createMigrationPrefix(sourceDir: string, throughIdx: number): Promise<string> {
  const journal = JSON.parse(
    await readFile(join(sourceDir, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ idx: number; tag: string }> };
  const entries = journal.entries.filter((entry) => entry.idx <= throughIdx);
  if (entries.at(-1)?.idx !== throughIdx) {
    throw new Error(`找不到 PostgreSQL 迁移 ${throughIdx}`);
  }

  const targetDir = await mkdtemp(join(tmpdir(), "nekusora-api-key-migrations-"));
  try {
    await mkdir(join(targetDir, "meta"));
    await writeFile(
      join(targetDir, "meta", "_journal.json"),
      `${JSON.stringify({ ...journal, entries }, null, 2)}\n`,
    );
    await Promise.all(entries.map((entry) =>
      copyFile(join(sourceDir, `${entry.tag}.sql`), join(targetDir, `${entry.tag}.sql`)),
    ));
    return targetDir;
  } catch (error) {
    await rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function main(): Promise<void> {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error("未配置 DATABASE_URL");

  const parsedAdminUrl = new URL(adminUrl);
  if (parsedAdminUrl.protocol !== "postgres:" && parsedAdminUrl.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL 不是 PostgreSQL URL");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(parsedAdminUrl.hostname)) {
    throw new Error("API Key PostgreSQL 集成测试只允许连接本机数据库");
  }

  const databaseName = `${DATABASE_PREFIX}${randomBytes(8).toString("hex")}`;
  const quotedDatabaseName = quoteDatabaseName(databaseName);
  const pgModule = "pg";
  const { default: pg } = await import(pgModule);
  const admin = new pg.Client({ connectionString: adminUrl });
  const migrationsDir = resolve(process.cwd(), "scripts/fixtures/api-key-data-path-pg");
  const upgradeSuffix = databaseName.slice(DATABASE_PREFIX.length);
  const upgradeUserId = `api-key-upgrade-user-${upgradeSuffix}`;
  const upgradeMasterId = `api-key-upgrade-master-${upgradeSuffix}`;
  const upgradeSubId = `api-key-upgrade-sub-${upgradeSuffix}`;
  let created = false;
  let operationFailed = false;
  let migrationPrefixDir: string | undefined;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${quotedDatabaseName}`);
    created = true;

    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${databaseName}`;
    const childEnv = {
      ...process.env,
      TEST_DATABASE_URL: testUrl.toString(),
      API_KEY_DATA_PATH_PG_TEST_DATABASE: databaseName,
      API_KEY_DATA_PATH_UPGRADE_USER_ID: upgradeUserId,
      API_KEY_DATA_PATH_UPGRADE_MASTER_ID: upgradeMasterId,
      API_KEY_DATA_PATH_UPGRADE_SUB_ID: upgradeSubId,
    };

    const migrationPool = new pg.Pool({ connectionString: testUrl.toString(), max: 1 });
    try {
      await migrationPool.query("CREATE EXTENSION IF NOT EXISTS vector");
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      const db = drizzle({ client: migrationPool });
      migrationPrefixDir = await createMigrationPrefix(migrationsDir, 0);
      await migrate(db, { migrationsFolder: migrationPrefixDir });
      await migrationPool.query(
        'INSERT INTO "user" ("id", "name", "email") VALUES ($1, $2, $3)',
        [upgradeUserId, "API key upgrade test", `${upgradeUserId}@example.test`],
      );
      await migrationPool.query(
        `INSERT INTO "api_keys" (
           "id", "user_id", "parent_id", "kind", "name", "key_hash", "key_prefix"
         ) VALUES
           ($1, $3, NULL, 'master', 'Upgrade master', 'upgrade-master-hash', 'sk-upgrade-master****abcd'),
           ($2, $3, $1, 'sub', 'Upgrade sub', 'upgrade-sub-hash', 'sk-upgrade-sub****abcd')`,
        [upgradeMasterId, upgradeSubId, upgradeUserId],
      );
      await migrate(db, { migrationsFolder: migrationsDir });
    } finally {
      await migrationPool.end().catch(() => undefined);
    }

    await runPnpm(["vitest", "run", "src/db/schema/api-key-data-path.pg.test.ts"], childEnv);
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    let cleanupError: unknown;
    try {
      if (created) {
        await admin.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
          [databaseName],
        ).catch(() => undefined);
        await admin.query(`DROP DATABASE ${quoteDatabaseName(databaseName)} WITH (FORCE)`);
      }
    } catch (error) {
      cleanupError = error;
    } finally {
      await admin.end().catch(() => undefined);
      if (migrationPrefixDir) {
        await rm(migrationPrefixDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    if (cleanupError) {
      if (!operationFailed) throw cleanupError;
      console.error("[api-key-data-pg-test] 隔离测试数据库清理失败");
    }
  }
}

void main().catch((error) => {
  const message = error instanceof Error
    ? error.message.replace(/postgres(?:ql)?:\/\/\S+/giu, "[REDACTED]")
    : "API Key PostgreSQL integration test failed";
  console.error(`[api-key-data-pg-test] ${message}`);
  process.exitCode = 1;
});
