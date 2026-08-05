import { sql } from "drizzle-orm";

const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 10 * 60 * 1000;
const CLIENT_LIMIT = 5;
const GLOBAL_LIMIT = 50;
const GLOBAL_FINGERPRINT = "global";

interface RateLimitRow {
  blocked_until: Date | string | null;
}

function rowsOf(result: unknown): RateLimitRow[] {
  if (Array.isArray(result)) return result as RateLimitRow[];
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows?: RateLimitRow[] }).rows ?? []);
  }
  return [];
}

/** 密码计算前检查客户端桶和分享全局桶。 */
export async function getShareUnlockRetryAfter(
  db: { execute: (query: unknown) => Promise<unknown> },
  shareId: string,
  clientFingerprint: string,
  now = new Date(),
): Promise<number | null> {
  const result = await db.execute(sql`
    SELECT "blocked_until"
      FROM "conversation_share_unlock_attempts"
     WHERE "share_id" = ${shareId}
       AND (("scope" = 'client' AND "client_fingerprint" = ${clientFingerprint})
         OR ("scope" = 'global' AND "client_fingerprint" = ${GLOBAL_FINGERPRINT}))
       AND "blocked_until" > ${now}
  `);
  const retryAt = rowsOf(result)
    .map((row) => row.blocked_until ? new Date(row.blocked_until).getTime() : 0)
    .reduce((latest, value) => Math.max(latest, value), 0);
  return retryAt > now.getTime() ? Math.ceil((retryAt - now.getTime()) / 1000) : null;
}

async function incrementBucket(
  tx: { execute: (query: unknown) => Promise<unknown> },
  shareId: string,
  scope: "client" | "global",
  fingerprint: string,
  limit: number,
  now: Date,
): Promise<void> {
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const blockedUntil = new Date(now.getTime() + BLOCK_MS);
  await tx.execute(sql`
    INSERT INTO "conversation_share_unlock_attempts"
      ("share_id", "scope", "client_fingerprint", "window_started_at", "failure_count", "blocked_until", "updated_at")
    VALUES (${shareId}, ${scope}, ${fingerprint}, ${now}, 1, NULL, ${now})
    ON CONFLICT ("share_id", "scope", "client_fingerprint") DO UPDATE SET
      "window_started_at" = CASE
        WHEN "conversation_share_unlock_attempts"."window_started_at" <= ${windowStart} THEN ${now}
        ELSE "conversation_share_unlock_attempts"."window_started_at"
      END,
      "failure_count" = CASE
        WHEN "conversation_share_unlock_attempts"."window_started_at" <= ${windowStart} THEN 1
        ELSE "conversation_share_unlock_attempts"."failure_count" + 1
      END,
      "blocked_until" = CASE
        WHEN (CASE
          WHEN "conversation_share_unlock_attempts"."window_started_at" <= ${windowStart} THEN 1
          ELSE "conversation_share_unlock_attempts"."failure_count" + 1
        END) >= ${limit} THEN ${blockedUntil}
        ELSE NULL
      END,
      "updated_at" = ${now}
  `);
}

/** 同一事务记录客户端与全局失败桶，避免多实例读改写竞态。 */
export async function recordShareUnlockFailure(
  db: { transaction: <T>(callback: (tx: { execute: (query: unknown) => Promise<unknown> }) => Promise<T>) => Promise<T> },
  shareId: string,
  clientFingerprint: string,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await incrementBucket(tx, shareId, "client", clientFingerprint, CLIENT_LIMIT, now);
    await incrementBucket(tx, shareId, "global", GLOBAL_FINGERPRINT, GLOBAL_LIMIT, now);
  });
}

/** 成功后只清当前客户端桶；全局桶保留分布式攻击历史。 */
export async function clearShareUnlockClientFailures(
  db: { execute: (query: unknown) => Promise<unknown> },
  shareId: string,
  clientFingerprint: string,
): Promise<void> {
  await db.execute(sql`
    DELETE FROM "conversation_share_unlock_attempts"
     WHERE "share_id" = ${shareId}
       AND "scope" = 'client'
       AND "client_fingerprint" = ${clientFingerprint}
  `);
}
