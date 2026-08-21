import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const DATABASE_PREFIX = "nekusora_core_pg_test_";

function quoteDatabaseName(name: string): string {
  if (!new RegExp(`^${DATABASE_PREFIX}[0-9a-f]{16}$`).test(name)) {
    throw new Error("拒绝操作非 Core PostgreSQL 测试数据库");
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

async function main(): Promise<void> {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error("未配置 DATABASE_URL");

  const parsedAdminUrl = new URL(adminUrl);
  if (parsedAdminUrl.protocol !== "postgres:" && parsedAdminUrl.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL 不是 PostgreSQL URL");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(parsedAdminUrl.hostname)) {
    throw new Error("Core PostgreSQL 集成测试只允许连接本机数据库");
  }

  const databaseName = `${DATABASE_PREFIX}${randomBytes(8).toString("hex")}`;
  const quotedDatabaseName = quoteDatabaseName(databaseName);
  const pgModule = "pg";
  const { default: pg } = await import(pgModule);
  const admin = new pg.Client({ connectionString: adminUrl });
  let created = false;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${quotedDatabaseName}`);
    created = true;

    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${databaseName}`;
    const childEnv = {
      ...process.env,
      DATABASE_URL: testUrl.toString(),
      TEST_DATABASE_URL: testUrl.toString(),
      GATEWAY_GOVERNANCE_PG_TEST_DATABASE: databaseName,
      GATEWAY_RETENTION_PG_TEST_DATABASE: databaseName,
      CHAT_COMPLETION_PG_TEST_DATABASE: databaseName,
      FILE_PROCESSING_PG_TEST_DATABASE: databaseName,
    };

    const migrationPool = new pg.Pool({ connectionString: testUrl.toString(), max: 1 });
    try {
      await migrationPool.query("CREATE EXTENSION IF NOT EXISTS vector");
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      const db = drizzle({ client: migrationPool });
      await migrate(db, { migrationsFolder: "../../drizzle/pg" });
    } finally {
      await migrationPool.end().catch(() => undefined);
    }
    await runPnpm([
      "--filter",
      "@nekusora/core",
      "exec",
      "vitest",
      "run",
      "src/lib/gateway-governance/repository.pg.test.ts",
      "src/lib/gateway-execution/retention.pg.test.ts",
      "src/lib/chat/completion.pg.test.ts",
      "src/lib/rag/process.pg.test.ts",
    ], childEnv);
  } finally {
    try {
      if (created) {
        await admin.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
          [databaseName],
        ).catch(() => undefined);
        await admin.query(`DROP DATABASE ${quoteDatabaseName(databaseName)} WITH (FORCE)`);
      }
    } finally {
      await admin.end().catch(() => undefined);
    }
  }
}

void main().catch((error) => {
  const message = error instanceof Error
    ? error.message.replace(/postgres(?:ql)?:\/\/\S+/giu, "[REDACTED]")
    : "Core PostgreSQL integration test failed";
  console.error(`[core-pg-test] ${message}`);
  process.exitCode = 1;
});
