import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const ENV_BACKUP = { ...process.env };

let tempDir: string | null = null;

afterEach(async () => {
  try {
    const { closeDb } = await import("@/lib/infra/db");
    await closeDb();
  } catch {
    // 测试可能在 db 模块导入前失败,此时无需关闭连接。
  }
  vi.resetModules();
  vi.doUnmock("@/auth");
  vi.doUnmock("drizzle-orm/node-postgres/migrator");
  process.env = { ...ENV_BACKUP };
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
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
  "user_memories",
  "user_settings",
  "verification",
];

describe("bootstrapDatabase", () => {
  it("SQLite 新环境可以自动迁移并创建首个管理员", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "nekusora-bootstrap-"));
    process.env.DB_DIALECT = "sqlite";
    process.env.SQLITE_PATH = join(tempDir, "local.db");
    process.env.DATA_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.BETTER_AUTH_SECRET = "0123456789abcdef0123456789abcdef";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.SEED_ADMIN_EMAIL = "admin-check@nekusora.local";
    process.env.SEED_ADMIN_PASSWORD = "change-me-on-first-login";
    process.env.SEED_ADMIN_NAME = "Bootstrap Admin";

    vi.doMock("@/auth", () => ({
      getAuth: async () => ({
        api: {
          signUpEmail: async ({ body }: { body: { email: string; name: string } }) => {
            const { getDb, getSchema } = await import("@/lib/infra/db");
            const db = await getDb();
            const schema = getSchema();

            await db.insert(schema.user).values({
              id: "seed-admin",
              name: body.name,
              email: body.email,
            });
          },
        },
      }),
    }));

    const { bootstrapDatabase } = await import("@/lib/infra/db/bootstrap");

    await expect(bootstrapDatabase()).resolves.toBeUndefined();

    const { getDb, getSchema } = await import("@/lib/infra/db");
    const db = await getDb();
    const schema = getSchema();
    const [admin] = await db
      .select({
        email: schema.user.email,
        role: schema.user.role,
        status: schema.user.status,
      })
      .from(schema.user)
      .where(eq(schema.user.email, "admin-check@nekusora.local"))
      .limit(1);

    expect(admin).toEqual({
      email: "admin-check@nekusora.local",
      role: "admin",
      status: "active",
    });

    await expect(
      db.insert(schema.user).values({
        id: "second-admin",
        name: "Second Admin",
        email: "second-admin@nekusora.local",
        role: "admin",
      }),
    ).rejects.toThrow();
  });
});

describe("runMigrations", () => {
  it("PG 已有完整基线 schema 但缺迁移记录时补写 Drizzle 记录", async () => {
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));

    const executedSql: string[] = [];
    const db = {
      execute: vi.fn(async (query: unknown) => {
        const text = String(query);
        executedSql.push(text);

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
      }),
    };

    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db, true)).resolves.toBeUndefined();

    expect(executedSql.some((text) => text.includes('insert into drizzle.__drizzle_migrations'))).toBe(true);
    expect(migrate).toHaveBeenCalledWith(db, { migrationsFolder: "drizzle/pg" });
  });

  it("PG 只有 enum 残留时继续执行幂等基线迁移", async () => {
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));

    const db = {
      execute: vi.fn(async (query: unknown) => {
        const text = String(query);
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
      }),
    };

    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db, true)).resolves.toBeUndefined();
    expect(migrate).toHaveBeenCalledWith(db, { migrationsFolder: "drizzle/pg" });
  });

  it("PG 只有部分基线表时拒绝自动收养", async () => {
    const migrate = vi.fn(async () => undefined);
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));

    const db = {
      execute: vi.fn(async (query: unknown) => {
        const text = String(query);
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
      }),
    };

    const { runMigrations } = await import("@/lib/infra/db/bootstrap");

    await expect(runMigrations(db, true)).rejects.toThrow("PG 已存在部分基线对象但没有 Drizzle 迁移记录");
    expect(migrate).not.toHaveBeenCalled();
  });
});
