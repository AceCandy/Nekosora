import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimGatewayRetention,
  deleteExpiredGatewayExecutions,
} from "./retention";

const databaseUrl = process.env.TEST_DATABASE_URL;
const expectedDatabase = process.env.GATEWAY_RETENTION_PG_TEST_DATABASE;

function isIsolatedTestDatabase(): boolean {
  if (!databaseUrl || !expectedDatabase) return false;
  try {
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    return databaseName === expectedDatabase
      && /^nekusora_core_pg_test_[0-9a-f]{16}$/.test(databaseName);
  } catch {
    return false;
  }
}

const describePg = isIsolatedTestDatabase() ? describe : describe.skip;

describePg("gateway retention PostgreSQL behavior", () => {
  const prefix = `retention-${randomUUID()}`;
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  });

  afterAll(async () => {
    await pool.query('DELETE FROM "gateway_executions" WHERE "request_id" LIKE $1', [`${prefix}%`]);
    await pool.query('DELETE FROM "gateway_retention_state" WHERE "id" = $1', ["gateway-executions"]);
    await pool.end();
  });

  it("并发领取每天只有一个成功", async () => {
    await pool.query('DELETE FROM "gateway_retention_state" WHERE "id" = $1', ["gateway-executions"]);
    const results = await Promise.all([
      claimGatewayRetention(),
      claimGatewayRetention(),
      claimGatewayRetention(),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("按边界和最旧顺序删除最多 1000 条并级联 attempts", async () => {
    await insertExecution("old-success", "success", "31 days", true);
    await insertExecution("recent-success", "success", "29 days", true);
    await insertExecution("old-failed", "failed", "91 days", true);
    await insertExecution("recent-failed", "failed", "89 days", true);
    await insertExecution("old-interrupted", "interrupted", "91 days", true);
    await insertExecution("old-running", "running", "120 days", false);
    await insertExecution("incomplete-failed", "failed", "120 days", false);
    await pool.query(
      `INSERT INTO "gateway_attempts" (
        "execution_id", "attempt", "status", "started_at", "completed_at", "created_at"
      ) VALUES ($1, 1, 'failed', statement_timestamp(), statement_timestamp(), statement_timestamp())`,
      [`${prefix}-old-failed`],
    );
    for (let index = 0; index < 1_005; index += 1) {
      await insertExecution(`batch-${String(index).padStart(4, "0")}`, "success", "40 days", true);
    }

    const plan = await pool.query<{ "QUERY PLAN": string }>(`
      EXPLAIN (COSTS OFF)
      SELECT "id"
        FROM "gateway_executions"
       WHERE "completed_at" IS NOT NULL
         AND (
           ("status" = 'success' AND "created_at" < statement_timestamp() - interval '30 days')
           OR (
             "status" IN ('failed', 'interrupted')
             AND "created_at" < statement_timestamp() - interval '90 days'
           )
         )
       ORDER BY "created_at" ASC, "id" ASC
       LIMIT 1000
    `);
    expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n"))
      .toContain("gateway_executions_retention_idx");

    const deleted = await deleteExpiredGatewayExecutions();
    expect(Object.values(deleted).reduce((sum, count) => sum + count, 0)).toBe(1_000);

    const survivors = await pool.query<{ request_id: string }>(
      'SELECT "request_id" FROM "gateway_executions" WHERE "request_id" LIKE $1',
      [`${prefix}%`],
    );
    const ids = new Set(survivors.rows.map((row) => row.request_id));
    expect(ids).toContain(`${prefix}-recent-success`);
    expect(ids).toContain(`${prefix}-recent-failed`);
    expect(ids).toContain(`${prefix}-old-running`);
    expect(ids).toContain(`${prefix}-incomplete-failed`);

    const attempt = await pool.query(
      'SELECT 1 FROM "gateway_attempts" WHERE "execution_id" = $1',
      [`${prefix}-old-failed`],
    );
    if (!ids.has(`${prefix}-old-failed`)) expect(attempt.rowCount).toBe(0);
  });

  async function insertExecution(
    suffix: string,
    status: string,
    age: string,
    completed: boolean,
  ): Promise<void> {
    const id = `${prefix}-${suffix}`;
    await pool.query(
      `INSERT INTO "gateway_executions" (
        "id", "request_id", "operation", "source", "model", "status",
        "started_at", "completed_at", "created_at"
      ) VALUES (
        $1, $1, 'chat.generate', 'gateway', 'test', $2,
        statement_timestamp() - $3::interval,
        CASE WHEN $4 THEN statement_timestamp() - $3::interval ELSE NULL END,
        statement_timestamp() - $3::interval
      )`,
      [id, status, age, completed],
    );
  }
});
