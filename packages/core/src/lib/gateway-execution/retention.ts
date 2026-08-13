import { sql } from "drizzle-orm";
import { getDb } from "@/lib/infra/db";
import {
  observeGatewayRetentionClaim,
  observeGatewayRetentionRun,
} from "@/lib/infra/metrics";

export const GATEWAY_RETENTION_BATCH_SIZE = 1_000;

type TerminalStatus = "success" | "failed" | "interrupted";
export type GatewayRetentionCounts = Record<TerminalStatus, number>;

export async function claimGatewayRetention(): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute(sql`
    INSERT INTO "gateway_retention_state" ("id", "last_claimed_date", "updated_at")
    VALUES (
      'gateway-executions',
      (statement_timestamp() AT TIME ZONE 'UTC')::date,
      statement_timestamp()
    )
    ON CONFLICT ("id") DO UPDATE SET
      "last_claimed_date" = excluded."last_claimed_date",
      "updated_at" = excluded."updated_at"
    WHERE "gateway_retention_state"."last_claimed_date" < excluded."last_claimed_date"
    RETURNING "id"
  `);
  return rowsOf(result).length === 1;
}

export async function deleteExpiredGatewayExecutions(): Promise<GatewayRetentionCounts> {
  const db = await getDb();
  const result = await db.execute(sql`
    WITH "doomed" AS (
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
       LIMIT ${GATEWAY_RETENTION_BATCH_SIZE}
       FOR UPDATE SKIP LOCKED
    )
    DELETE FROM "gateway_executions" AS "execution"
     USING "doomed"
     WHERE "execution"."id" = "doomed"."id"
     RETURNING "execution"."status"
  `);
  const counts: GatewayRetentionCounts = { success: 0, failed: 0, interrupted: 0 };
  for (const row of rowsOf<{ status: TerminalStatus }>(result)) {
    if (row.status in counts) counts[row.status] += 1;
  }
  return counts;
}

export async function runGatewayRetention(): Promise<void> {
  let claimed: boolean;
  try {
    claimed = await claimGatewayRetention();
  } catch (error) {
    observeClaim("failed");
    throw error;
  }
  observeClaim(claimed ? "claimed" : "skipped");
  if (!claimed) return;

  const startedAt = performance.now();
  try {
    const deleted = await deleteExpiredGatewayExecutions();
    observeRun("success", deleted, performance.now() - startedAt);
  } catch (error) {
    observeRun("failed", {}, performance.now() - startedAt);
    throw error;
  }
}

function observeClaim(outcome: "claimed" | "skipped" | "failed"): void {
  try {
    observeGatewayRetentionClaim(outcome);
  } catch {
    // Metrics remain best-effort and never change retention ownership.
  }
}

function observeRun(
  outcome: "success" | "failed",
  deleted: Partial<GatewayRetentionCounts>,
  durationMs: number,
): void {
  try {
    observeGatewayRetentionRun({ outcome, deleted, durationMs });
  } catch {
    // Metrics remain best-effort and never change deletion results.
  }
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows?: T[] }).rows ?? [];
  }
  return [];
}
