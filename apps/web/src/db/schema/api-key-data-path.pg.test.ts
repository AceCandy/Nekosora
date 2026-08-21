import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const expectedDatabase = process.env.API_KEY_DATA_PATH_PG_TEST_DATABASE;
const upgradeUserId = process.env.API_KEY_DATA_PATH_UPGRADE_USER_ID;
const upgradeMasterId = process.env.API_KEY_DATA_PATH_UPGRADE_MASTER_ID;
const upgradeSubId = process.env.API_KEY_DATA_PATH_UPGRADE_SUB_ID;

function isIsolatedTestDatabase(): boolean {
  if (!databaseUrl || !expectedDatabase || !upgradeUserId || !upgradeMasterId || !upgradeSubId) {
    return false;
  }
  try {
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    return databaseName === expectedDatabase
      && /^nekusora_api_key_data_test_[0-9a-f]{16}$/.test(databaseName);
  } catch {
    return false;
  }
}

function collectIndexNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectIndexNames);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const current = typeof record["Index Name"] === "string" ? [record["Index Name"]] : [];
  return [...current, ...Object.values(record).flatMap(collectIndexNames)];
}

const describePg = isIsolatedTestDatabase() ? describe : describe.skip;

describePg("API key data path PostgreSQL migration", () => {
  const userId = `api-key-plan-${randomUUID()}`;
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await pool.query(
      'INSERT INTO "user" ("id", "name", "email") VALUES ($1, $2, $3)',
      [userId, "API key plan test", `${userId}@example.test`],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('DELETE FROM "user" WHERE "id" = $1', [userId]);
    await pool.end();
  });

  it("upgrades pre-parent-removal data without losing API key rows", async () => {
    const keys = await pool!.query<{
      enabled: boolean;
      id: string;
      key_hash: string;
      kind: string;
      name: string;
    }>(
      `SELECT "id", "kind", "name", "key_hash", "enabled"
       FROM "api_keys"
       WHERE "id" = ANY($1::text[])
       ORDER BY "id"`,
      [[upgradeMasterId, upgradeSubId]],
    );
    expect(keys.rows).toEqual([
      {
        id: upgradeMasterId,
        kind: "master",
        name: "Upgrade master",
        key_hash: "upgrade-master-hash",
        enabled: true,
      },
      {
        id: upgradeSubId,
        kind: "sub",
        name: "Upgrade sub",
        key_hash: "upgrade-sub-hash",
        enabled: true,
      },
    ]);
  });

  it("applies the column removal and prefix index", async () => {
    const columns = await pool!.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'parent_id'`,
    );
    expect(columns.rows).toHaveLength(0);

    const indexes = await pool!.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'api_keys'`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toContain("api_keys_key_prefix_idx");
    expect(indexes.rows.map((row) => row.indexname)).not.toContain("api_keys_parent_idx");
  });

  it("uses the prefix index for the real authentication candidate predicate", async () => {
    await pool!.query(
      `INSERT INTO "api_keys" (
         "id", "user_id", "kind", "name", "key_hash", "key_prefix"
       )
       SELECT
         'api-key-plan-' || series,
         $1,
         'sub',
         'Plan key ' || series,
         md5(series::text),
         'sk-plan-' || lpad(series::text, 8, '0') || '****abcd'
       FROM generate_series(1, 20000) AS series`,
      [userId],
    );
    await pool!.query('ANALYZE "api_keys"');
    await pool!.query('ANALYZE "user"');

    const explained = await pool!.query<Record<string, unknown>>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT k.*
       FROM "api_keys" AS k
       INNER JOIN "user" AS u ON k."user_id" = u."id"
       WHERE (k."key_prefix" = $1 OR k."key_prefix" = $2)
         AND k."enabled" = true
         AND u."status" = 'active'`,
      ["sk-plan-00010000****abcd", "sk-plan-missing****abcd"],
    );
    const plan = explained.rows[0]?.["QUERY PLAN"];
    expect(collectIndexNames(plan)).toContain("api_keys_key_prefix_idx");
  }, 30_000);
});
