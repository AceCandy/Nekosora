import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  DEFAULT_GATEWAY_GOVERNANCE_POLICY,
  type GatewayGovernancePolicy,
} from "./policy";
import {
  GatewayGovernanceRepository,
  GovernanceRejectedError,
  GovernanceStateError,
} from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const expectedDatabase = process.env.GATEWAY_GOVERNANCE_PG_TEST_DATABASE;

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

describePg("gateway governance PostgreSQL repository", () => {
  const userId = `governance-${randomUUID()}`;
  const apiKeyId = randomUUID();
  const identity = { userId, apiKeyId };
  let pool: pg.Pool;
  let repository: GatewayGovernanceRepository;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 6 });
    repository = new GatewayGovernanceRepository(drizzle(pool));
    await pool.query(
      'INSERT INTO "user" ("id", "name", "email") VALUES ($1, $2, $3)',
      [userId, "Governance test", `${userId}@example.test`],
    );
    await pool.query(
      `INSERT INTO "api_keys" (
        "id", "user_id", "kind", "name", "key_hash", "key_prefix"
      ) VALUES ($1, $2, 'master', 'test', $3, $4)`,
      [apiKeyId, userId, randomUUID(), "sk-test****test"],
    );
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM "gateway_governance_leases"
       WHERE "key_subject_id" IN (
         SELECT "id" FROM "gateway_governance_subjects" WHERE "api_key_id" = $1
       ) OR "user_subject_id" IN (
         SELECT "id" FROM "gateway_governance_subjects" WHERE "user_id" = $2
       )`,
      [apiKeyId, userId],
    );
    await pool.query(
      'DELETE FROM "system_settings" WHERE "namespace" = $1 AND "key" = $2',
      ["gateway", "request_governance_v1"],
    );
    await pool.query('DELETE FROM "user" WHERE "id" = $1', [userId]);
    await pool.end();
  });

  it("loads the policy row published by settings control", async () => {
    const policy = withLimits({ key: { rpm: 321 } });
    await pool.query(
      `INSERT INTO "system_settings" ("namespace", "key", "value")
       VALUES ('gateway', 'request_governance_v1', $1)
       ON CONFLICT ("namespace", "key") DO UPDATE SET "value" = excluded."value"`,
      [JSON.stringify(policy)],
    );
    await expect(repository.loadPolicy()).resolves.toEqual({ policy, source: "stored" });

    const rows = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS "count" FROM "system_settings"
       WHERE "namespace" = 'gateway' AND "key" = 'request_governance_v1'`,
    );
    expect(rows.rows[0]?.count).toBe("1");
  });

  it("accumulates hourly counts and keeps the highest observations", async () => {
    const bucketStart = new Date("2026-08-24T12:00:00.000Z");
    const delta = {
      bucketStart,
      scope: "key" as const,
      requestCount: 2,
      rpmPeak: 4,
      concurrencyPeak: 3,
      rateRejected: 1,
      concurrencyRejected: 0,
      quotaChatTokensRejected: 0,
      quotaImageCountRejected: 0,
      quotaTtsCodePointsRejected: 0,
      quotaSttSecondsRejected: 0,
    };
    await pool.query(
      'DELETE FROM "gateway_governance_hourly" WHERE "bucket_start" = $1 AND "scope" = $2',
      [bucketStart, "key"],
    );

    await repository.upsertHourly([delta]);
    await repository.upsertHourly([{
      ...delta,
      requestCount: 5,
      rpmPeak: 9,
      concurrencyPeak: 2,
      rateRejected: 0,
      concurrencyRejected: 1,
    }]);

    const result = await pool.query<{
      request_count: string;
      rpm_peak: number;
      concurrency_peak: number;
      rate_rejected: string;
      concurrency_rejected: string;
    }>(`
      SELECT "request_count", "rpm_peak", "concurrency_peak",
             "rate_rejected", "concurrency_rejected"
        FROM "gateway_governance_hourly"
       WHERE "bucket_start" = $1 AND "scope" = 'key'
    `, [bucketStart]);
    expect(result.rows).toEqual([{
      request_count: "7",
      rpm_peak: 9,
      concurrency_peak: 3,
      rate_rejected: "1",
      concurrency_rejected: "1",
    }]);
  });

  it("lets only one concurrent request consume a one-token Key/User burst", async () => {
    await pool.query(
      'DELETE FROM "gateway_governance_subjects" WHERE "api_key_id" = $1 OR "user_id" = $2',
      [apiKeyId, userId],
    );
    const policy = withLimits({
      key: { rpm: 1, burst: 1 },
      user: { rpm: 1, burst: 1 },
    });

    const results = await Promise.allSettled([
      repository.consumeRate(identity, policy),
      repository.consumeRate(identity, policy),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        affectedScopes: ["key", "user"],
      }),
    });
  });

  it("serializes concurrent Key/User lease admission to one winner", async () => {
    const policy = withLimits({
      key: { concurrency: 1 },
      user: { concurrency: 1 },
    });
    const results = await Promise.allSettled([
      repository.acquireLease({ identity, operation: "chat.stream", policy }),
      repository.acquireLease({ identity, operation: "chat.stream", policy }),
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof repository.acquireLease>>> =>
        result.status === "fulfilled",
    );
    expect(fulfilled).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await repository.finalize(fulfilled[0].value.id);
  });

  it("reserves both quota windows and settles actual usage exactly once", async () => {
    const policy = withLimits({});
    const lease = await repository.acquireLease({
      identity,
      operation: "image.generate",
      policy,
    });
    await repository.reserveQuota({
      leaseId: lease.id,
      quotaKind: "image_count",
      units: 10,
      policy,
    });
    await repository.markProviderStarted(lease.id);
    await expect(repository.finalize(lease.id, 7)).resolves.toMatchObject({
      settled: true,
      quotaKind: "image_count",
      actualUnits: 7,
    });
    await expect(repository.finalize(lease.id, 7)).resolves.toEqual({ settled: false });

    const windows = await quotaWindows("image_count");
    expect(windows).toHaveLength(2);
    expect(windows).toEqual(expect.arrayContaining([
      expect.objectContaining({ reserved_units: "0", used_units: "7" }),
      expect.objectContaining({ reserved_units: "0", used_units: "7" }),
    ]));
  });

  it("refunds the full reservation when Provider never started", async () => {
    const policy = withLimits({});
    const before = await quotaWindows("tts_code_points");
    const lease = await repository.acquireLease({
      identity,
      operation: "audio.speech",
      policy,
    });
    await repository.reserveQuota({
      leaseId: lease.id,
      quotaKind: "tts_code_points",
      units: 12,
      policy,
    });
    await repository.finalize(lease.id, 12);
    const after = await quotaWindows("tts_code_points");

    expect(before).toHaveLength(0);
    expect(after).toEqual(expect.arrayContaining([
      expect.objectContaining({ reserved_units: "0", used_units: "0" }),
      expect.objectContaining({ reserved_units: "0", used_units: "0" }),
    ]));
  });

  it("does not revive an expired lease with heartbeat or Provider start", async () => {
    const lease = await repository.acquireLease({
      identity,
      operation: "audio.transcription",
      policy: withLimits({}),
    });
    await pool.query(
      `UPDATE "gateway_governance_leases"
       SET "lease_expires_at" = statement_timestamp() - interval '1 second'
       WHERE "id" = $1`,
      [lease.id],
    );
    await expect(repository.heartbeat(lease.id)).rejects.toThrow();
    await expect(repository.markProviderStarted(lease.id)).rejects.toThrow();
    await expect(repository.reapExpiredOne()).resolves.toBe(true);
    await expect(repository.finalize(lease.id)).resolves.toEqual({ settled: false });
  });

  it("serializes acquire with finalize on the same active lease", async () => {
    const policy = withLimits({
      key: { concurrency: 1 },
      user: { concurrency: 1 },
    });
    const lease = await repository.acquireLease({
      identity,
      operation: "chat.stream",
      policy,
    });
    const holder = await holdLeaseRowLock(lease.id);
    const finalizer = await createContender();
    const acquirer = await createContender();
    const pending: Promise<unknown>[] = [];

    try {
      const finalizePromise = finalizer.repository.finalize(lease.id);
      pending.push(finalizePromise);
      await waitForLockWait(finalizer.backendPid);

      const acquirePromise = acquirer.repository.acquireLease({
        identity,
        operation: "chat.stream",
        policy,
      });
      pending.push(acquirePromise);
      await waitForLockWait(acquirer.backendPid);
      await holder.commit();

      const [finalized, acquired] = await Promise.allSettled([
        finalizePromise,
        acquirePromise,
      ]);
      expect(finalized).toMatchObject({
        status: "fulfilled",
        value: { settled: true },
      });
      const ids = await leaseIds();
      expect(ids).not.toContain(lease.id);
      if (acquired.status === "fulfilled") {
        expect(ids).toEqual([acquired.value.id]);
        await repository.finalize(acquired.value.id);
      } else {
        expect(acquired.reason).toBeInstanceOf(GovernanceRejectedError);
        expect(acquired.reason).toMatchObject({ reason: "concurrency" });
        expect(ids).toEqual([]);
      }
    } finally {
      await holder.rollback();
      await Promise.allSettled(pending);
      await Promise.all([finalizer.close(), acquirer.close()]);
    }
  }, 15_000);

  it("settles once when reaper overlaps finalize", async () => {
    const policy = withLimits({});
    const lease = await repository.acquireLease({
      identity,
      operation: "audio.transcription",
      policy,
    });
    await repository.reserveQuota({
      leaseId: lease.id,
      quotaKind: "stt_seconds",
      units: 5,
      policy,
    });
    await repository.markProviderStarted(lease.id);
    await expireLease(lease.id);
    const holder = await holdLeaseRowLock(lease.id);
    const finalizer = await createContender();
    let finalizePromise: Promise<Awaited<ReturnType<typeof repository.finalize>>> | undefined;

    try {
      finalizePromise = finalizer.repository.finalize(lease.id, 3);
      await waitForLockWait(finalizer.backendPid);
      await expect(repository.reapExpiredOne()).resolves.toBe(false);
      await holder.commit();
      await expect(finalizePromise).resolves.toMatchObject({
        settled: true,
        quotaKind: "stt_seconds",
        actualUnits: 3,
      });

      expect(await leaseExists(lease.id)).toBe(false);
      expect(await quotaWindows("stt_seconds")).toEqual(expect.arrayContaining([
        expect.objectContaining({ reserved_units: "0", used_units: "3" }),
        expect.objectContaining({ reserved_units: "0", used_units: "3" }),
      ]));
    } finally {
      await holder.rollback();
      if (finalizePromise) await Promise.allSettled([finalizePromise]);
      await finalizer.close();
    }
  }, 15_000);

  it("does not let heartbeat revive a lease after waiting across expiry", async () => {
    const lease = await repository.acquireLease({
      identity,
      operation: "audio.transcription",
      policy: withLimits({}),
    });
    const expiresAt = await setLeaseExpiryAfter(lease.id, 2_000);
    const holder = await holdLeaseRowLock(lease.id);
    const heartbeater = await createContender();
    let heartbeatPromise: Promise<Date> | undefined;

    try {
      heartbeatPromise = heartbeater.repository.heartbeat(lease.id);
      await waitForLockWait(heartbeater.backendPid);
      await waitUntilAfter(expiresAt);
      await expect(repository.reapExpiredOne()).resolves.toBe(false);
      await holder.commit();
      await expect(heartbeatPromise).rejects.toBeInstanceOf(GovernanceStateError);
      await expect(repository.reapExpiredOne()).resolves.toBe(true);
      expect(await leaseExists(lease.id)).toBe(false);
    } finally {
      await holder.rollback();
      if (heartbeatPromise) await Promise.allSettled([heartbeatPromise]);
      await heartbeater.close();
    }
  }, 15_000);

  it("does not mark Provider started after waiting across lease expiry", async () => {
    const lease = await repository.acquireLease({
      identity,
      operation: "image.generate",
      policy: withLimits({}),
    });
    const expiresAt = await setLeaseExpiryAfter(lease.id, 2_000);
    const holder = await holdLeaseRowLock(lease.id);
    const marker = await createContender();
    let markPromise: Promise<void> | undefined;

    try {
      markPromise = marker.repository.markProviderStarted(lease.id);
      await waitForLockWait(marker.backendPid);
      await waitUntilAfter(expiresAt);
      await expect(repository.reapExpiredOne()).resolves.toBe(false);
      await holder.commit();
      await expect(markPromise).rejects.toBeInstanceOf(GovernanceStateError);
      await expect(repository.reapExpiredOne()).resolves.toBe(true);
      expect(await leaseExists(lease.id)).toBe(false);
    } finally {
      await holder.rollback();
      if (markPromise) await Promise.allSettled([markPromise]);
      await marker.close();
    }
  }, 15_000);

  it("does not leave a reservation when reserve overlaps reaping an expired lease", async () => {
    const policy = withLimits({});
    const lease = await repository.acquireLease({
      identity,
      operation: "chat.generate",
      policy,
    });
    await expireLease(lease.id);
    const before = await quotaWindows("chat_tokens");
    const holder = await holdLeaseRowLock(lease.id);
    const reserver = await createContender();
    let reservePromise: Promise<void> | undefined;

    try {
      reservePromise = reserver.repository.reserveQuota({
        leaseId: lease.id,
        quotaKind: "chat_tokens",
        units: 10,
        policy,
      });
      await waitForLockWait(reserver.backendPid);
      await expect(repository.reapExpiredOne()).resolves.toBe(false);
      await holder.commit();
      await expect(reservePromise).rejects.toBeInstanceOf(GovernanceStateError);
      await expect(repository.reapExpiredOne()).resolves.toBe(false);
      expect(await leaseExists(lease.id)).toBe(false);
      expect(await quotaWindows("chat_tokens")).toEqual(before);
    } finally {
      await holder.rollback();
      if (reservePromise) await Promise.allSettled([reservePromise]);
      await reserver.close();
    }
  }, 15_000);

  async function createContender(): Promise<{
    repository: GatewayGovernanceRepository;
    backendPid: number;
    close(): Promise<void>;
  }> {
    const contenderPool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    const result = await contenderPool.query<{ pid: number }>(
      'SELECT pg_backend_pid()::integer AS "pid"',
    );
    const backendPid = result.rows[0]?.pid;
    if (!backendPid) {
      await contenderPool.end();
      throw new Error("Failed to resolve contender PostgreSQL backend");
    }
    return {
      repository: new GatewayGovernanceRepository(drizzle(contenderPool)),
      backendPid,
      close: () => contenderPool.end(),
    };
  }

  async function holdLeaseRowLock(leaseId: string): Promise<{
    commit(): Promise<void>;
    rollback(): Promise<void>;
  }> {
    const client = await pool.connect();
    let finished = false;
    const finish = async (command: "COMMIT" | "ROLLBACK") => {
      if (finished) return;
      finished = true;
      try {
        await client.query(command);
      } finally {
        client.release();
      }
    };
    try {
      await client.query("BEGIN");
      const result = await client.query(
        'SELECT "id" FROM "gateway_governance_leases" WHERE "id" = $1 FOR UPDATE',
        [leaseId],
      );
      if (result.rowCount !== 1) throw new Error("Lease row is missing");
      return {
        commit: () => finish("COMMIT"),
        rollback: () => finish("ROLLBACK"),
      };
    } catch (error) {
      await finish("ROLLBACK");
      throw error;
    }
  }

  async function waitForLockWait(backendPid: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const result = await pool.query<{ wait_event_type: string | null }>(
        'SELECT "wait_event_type" FROM "pg_stat_activity" WHERE "pid" = $1',
        [backendPid],
      );
      if (result.rows[0]?.wait_event_type === "Lock") return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("PostgreSQL contender did not wait for a lock");
  }

  async function expireLease(leaseId: string): Promise<void> {
    await pool.query(
      `UPDATE "gateway_governance_leases"
       SET "lease_expires_at" = statement_timestamp() - interval '1 second'
       WHERE "id" = $1`,
      [leaseId],
    );
  }

  async function setLeaseExpiryAfter(leaseId: string, milliseconds: number): Promise<Date> {
    const result = await pool.query<{ lease_expires_at: Date }>(
      `UPDATE "gateway_governance_leases"
       SET "lease_expires_at" = statement_timestamp()
         + $2::double precision * interval '1 millisecond'
       WHERE "id" = $1
       RETURNING "lease_expires_at"`,
      [leaseId, milliseconds],
    );
    const expiresAt = result.rows[0]?.lease_expires_at;
    if (!expiresAt) throw new Error("Failed to set lease expiry");
    return expiresAt;
  }

  async function waitUntilAfter(expiresAt: Date): Promise<void> {
    await pool.query(
      `SELECT pg_sleep(
        greatest(0, extract(epoch from ($1::timestamptz - statement_timestamp()))) + 0.05
      )`,
      [expiresAt],
    );
  }

  async function leaseExists(leaseId: string): Promise<boolean> {
    const result = await pool.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM "gateway_governance_leases" WHERE "id" = $1) AS "exists"',
      [leaseId],
    );
    return result.rows[0]?.exists ?? false;
  }

  async function leaseIds(): Promise<string[]> {
    const result = await pool.query<{ id: string }>(
      `SELECT l."id"
       FROM "gateway_governance_leases" l
       INNER JOIN "gateway_governance_subjects" s ON s."id" = l."key_subject_id"
       WHERE s."api_key_id" = $1
       ORDER BY l."id"`,
      [apiKeyId],
    );
    return result.rows.map((row) => row.id);
  }

  async function quotaWindows(kind: string): Promise<Array<{
    reserved_units: string;
    used_units: string;
  }>> {
    const result = await pool.query<{
      reserved_units: string;
      used_units: string;
    }>(
      `SELECT "reserved_units"::text, "used_units"::text
       FROM "gateway_quota_windows" q
       INNER JOIN "gateway_governance_subjects" s ON s."id" = q."subject_id"
       WHERE q."quota_kind" = $1
         AND (s."api_key_id" = $2 OR s."user_id" = $3)
       ORDER BY q."subject_id"`,
      [kind, apiKeyId, userId],
    );
    return result.rows;
  }
});

function withLimits(overrides: {
  key?: Partial<GatewayGovernancePolicy["key"]>;
  user?: Partial<GatewayGovernancePolicy["user"]>;
}): GatewayGovernancePolicy {
  return {
    version: 1,
    key: { ...DEFAULT_GATEWAY_GOVERNANCE_POLICY.key, ...overrides.key },
    user: { ...DEFAULT_GATEWAY_GOVERNANCE_POLICY.user, ...overrides.user },
  };
}
