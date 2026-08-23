import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ErrorCode } from "@/lib/errors";
import type {
  GatewayGovernancePolicy,
  GatewayPolicySource,
  GatewayScopeLimits,
} from "./policy";
import {
  GATEWAY_GOVERNANCE_NAMESPACE,
  GATEWAY_GOVERNANCE_POLICY_KEY,
  gatewayGovernancePolicyFingerprint,
  loadGatewayGovernancePolicy,
} from "./policy";

export const GOVERNANCE_LEASE_TTL_SECONDS = 120;

export type GatewayGovernanceOperation =
  | "chat.stream"
  | "chat.generate"
  | "image.generate"
  | "audio.speech"
  | "audio.transcription"
  | "mcp.search";

export type GatewayQuotaKind =
  | "chat_tokens"
  | "image_count"
  | "tts_code_points"
  | "stt_seconds";

export type GovernanceScope = "key" | "user";
export type GovernanceRejectionReason = "rate" | "concurrency" | "quota";

export interface GovernanceIdentity {
  userId: string;
  apiKeyId: string;
}

export interface GovernanceObservation {
  keyRpm?: number;
  userRpm?: number;
  keyConcurrency?: number;
  userConcurrency?: number;
}

export interface GovernanceLease {
  id: string;
  keySubjectId: string;
  userSubjectId: string;
  operation: GatewayGovernanceOperation;
  expiresAt: Date;
  observation?: GovernanceObservation;
}

export interface GatewayGovernanceHourlyDelta {
  bucketStart: Date;
  scope: GovernanceScope;
  requestCount: number;
  rpmPeak: number;
  concurrencyPeak: number;
  rateRejected: number;
  concurrencyRejected: number;
  quotaChatTokensRejected: number;
  quotaImageCountRejected: number;
  quotaTtsCodePointsRejected: number;
  quotaSttSecondsRejected: number;
}

export interface LoadedGatewayGovernancePolicy {
  policy: GatewayGovernancePolicy;
  source: GatewayPolicySource;
}

export interface GovernanceSettlement {
  settled: boolean;
  quotaKind?: GatewayQuotaKind;
  actualUnits?: number;
  overage?: boolean;
}

export class GovernanceRejectedError extends Error {
  readonly reason: GovernanceRejectionReason;
  readonly scope: GovernanceScope;
  readonly retryAfterSeconds: number;
  readonly quotaKind?: GatewayQuotaKind;
  readonly observation?: GovernanceObservation;
  readonly affectedScopes: readonly GovernanceScope[];

  constructor(input: {
    reason: GovernanceRejectionReason;
    scope: GovernanceScope;
    retryAfterSeconds: number;
    quotaKind?: GatewayQuotaKind;
    observation?: GovernanceObservation;
    affectedScopes?: readonly GovernanceScope[];
  }) {
    super(`Gateway governance ${input.reason} limit exceeded`);
    this.name = "GovernanceRejectedError";
    this.reason = input.reason;
    this.scope = input.scope;
    this.retryAfterSeconds = Math.max(1, Math.ceil(input.retryAfterSeconds));
    this.quotaKind = input.quotaKind;
    this.observation = input.observation;
    this.affectedScopes = input.affectedScopes ?? [input.scope];
  }
}

export class GovernanceStateError extends Error {
  readonly code = ErrorCode.SERVER_SERVICE_UNAVAILABLE;
  readonly statusCode = 503;

  constructor(message = "Gateway governance state is unavailable") {
    super(message);
    this.name = "GovernanceStateError";
  }
}

interface SqlExecutor {
  execute(query: unknown): Promise<unknown>;
}

interface GovernanceDatabase extends SqlExecutor {
  transaction<T>(callback: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

interface SubjectPair {
  keySubjectId: string;
  userSubjectId: string;
}

interface LeaseRow {
  id: string;
  key_subject_id: string;
  user_subject_id: string;
  operation: GatewayGovernanceOperation;
  quota_kind: GatewayQuotaKind | null;
  quota_month_start: Date | string | null;
  reserved_units: number | string | null;
  provider_started_at: Date | string | null;
  lease_expires_at: Date | string;
}

interface RejectionResult {
  rejection: GovernanceRejectedError;
}

export class GatewayGovernanceRepository {
  constructor(private readonly db: GovernanceDatabase) {}

  async loadPolicy(): Promise<LoadedGatewayGovernancePolicy> {
    const result = await this.db.execute(sql`
      SELECT "value"
        FROM "system_settings"
       WHERE "namespace" = ${GATEWAY_GOVERNANCE_NAMESPACE}
         AND "key" = ${GATEWAY_GOVERNANCE_POLICY_KEY}
       LIMIT 1
    `);
    const [row] = rowsOf<{ value: string }>(result);
    return loadGatewayGovernancePolicy(row ? String(row.value) : null);
  }

  async consumeRate(
    identity: GovernanceIdentity,
    policy: GatewayGovernancePolicy,
  ): Promise<GovernanceObservation> {
    const fingerprint = gatewayGovernancePolicyFingerprint(policy);
    const result = await this.db.transaction<{
      observation: GovernanceObservation;
      rejection?: GovernanceRejectedError;
    }>(async (tx) => {
      const subjects = await ensureSubjects(tx, identity, policy, fingerprint);
      await lockSubject(tx, subjects.keySubjectId);
      await lockSubject(tx, subjects.userSubjectId);

      const keyRate = await refillSubject(
        tx,
        subjects.keySubjectId,
        policy.key,
        fingerprint,
      );
      const userRate = await refillSubject(
        tx,
        subjects.userSubjectId,
        policy.user,
        fingerprint,
      );
      const observation = {
        keyRpm: keyRate.minuteRequests,
        userRpm: userRate.minuteRequests,
      };
      const failures = [
        rateFailure("key", keyRate.tokens, policy.key.rpm, observation),
        rateFailure("user", userRate.tokens, policy.user.rpm, observation),
      ].filter((failure): failure is GovernanceRejectedError => failure !== null);
      if (failures.length > 0) {
        return { observation, rejection: longestRejection(failures) };
      }

      await decrementRateToken(tx, subjects.keySubjectId);
      await decrementRateToken(tx, subjects.userSubjectId);
      return { observation };
    });
    if (result.rejection) throw result.rejection;
    return result.observation;
  }

  async acquireLease(input: {
    identity: GovernanceIdentity;
    operation: GatewayGovernanceOperation;
    policy: GatewayGovernancePolicy;
    leaseId?: string;
  }): Promise<GovernanceLease> {
    const fingerprint = gatewayGovernancePolicyFingerprint(input.policy);
    const result = await this.db.transaction<GovernanceLease | RejectionResult>(async (tx) => {
      const subjects = await ensureSubjects(tx, input.identity, input.policy, fingerprint);

      const related = await lockRelatedLeases(tx, subjects);
      await lockSubject(tx, subjects.keySubjectId);
      await lockSubject(tx, subjects.userSubjectId);

      const databaseNow = await readDatabaseNow(tx);
      for (const lease of related) {
        if (dateValue(lease.lease_expires_at).getTime() <= databaseNow.getTime()) {
          await settleLockedLease(tx, lease, lease.provider_started_at ? reservedUnits(lease) : 0);
        }
      }

      const activity = await readActiveLeaseCounts(tx, subjects);
      const rejectedObservation = {
        keyConcurrency: activity.keyCount,
        userConcurrency: activity.userCount,
      };
      const failures: GovernanceRejectedError[] = [];
      if (activity.keyCount >= input.policy.key.concurrency) {
        failures.push(new GovernanceRejectedError({
          reason: "concurrency",
          scope: "key",
          retryAfterSeconds: secondsUntil(activity.keyRetryAt, activity.now),
          observation: rejectedObservation,
        }));
      }
      if (activity.userCount >= input.policy.user.concurrency) {
        failures.push(new GovernanceRejectedError({
          reason: "concurrency",
          scope: "user",
          retryAfterSeconds: secondsUntil(activity.userRetryAt, activity.now),
          observation: rejectedObservation,
        }));
      }
      if (failures.length > 0) return { rejection: longestRejection(failures) };

      const id = input.leaseId ?? randomUUID();
      const insert = await tx.execute(sql`
        INSERT INTO "gateway_governance_leases" (
          "id", "key_subject_id", "user_subject_id", "operation", "lease_expires_at"
        )
        VALUES (
          ${id},
          ${subjects.keySubjectId},
          ${subjects.userSubjectId},
          ${input.operation},
          statement_timestamp() + interval '120 seconds'
        )
        RETURNING "lease_expires_at"
      `);
      const [row] = rowsOf<{ lease_expires_at: Date | string }>(insert);
      if (!row) throw new GovernanceStateError("Failed to create governance lease");
      return {
        id,
        keySubjectId: subjects.keySubjectId,
        userSubjectId: subjects.userSubjectId,
        operation: input.operation,
        expiresAt: dateValue(row.lease_expires_at),
        observation: {
          keyConcurrency: activity.keyCount + 1,
          userConcurrency: activity.userCount + 1,
        },
      };
    });
    if ("rejection" in result) throw result.rejection;
    return result;
  }

  async reserveQuota(input: {
    leaseId: string;
    quotaKind: GatewayQuotaKind;
    units: number;
    policy: GatewayGovernancePolicy;
  }): Promise<void> {
    requirePositiveUnits(input.units);
    const result = await this.db.transaction<RejectionResult | "ok" | "expired">(async (tx) => {
      const lease = await lockLease(tx, input.leaseId);
      if (!lease) return "expired";
      const now = await readDatabaseNow(tx);
      await lockSubject(tx, lease.key_subject_id);
      await lockSubject(tx, lease.user_subject_id);
      if (dateValue(lease.lease_expires_at).getTime() <= now.getTime()) {
        await settleLockedLease(tx, lease, lease.provider_started_at ? reservedUnits(lease) : 0);
        return "expired";
      }
      if (lease.quota_kind !== null) {
        if (lease.quota_kind === input.quotaKind && reservedUnits(lease) === input.units) {
          return "ok";
        }
        throw new GovernanceStateError("Governance lease already has a different reservation");
      }

      const month = await readUtcMonth(tx);
      await ensureQuotaWindow(tx, lease.key_subject_id, input.quotaKind, month.start);
      await ensureQuotaWindow(tx, lease.user_subject_id, input.quotaKind, month.start);
      const keyWindow = await lockQuotaWindow(
        tx,
        lease.key_subject_id,
        input.quotaKind,
        month.start,
      );
      const userWindow = await lockQuotaWindow(
        tx,
        lease.user_subject_id,
        input.quotaKind,
        month.start,
      );

      const failures: GovernanceRejectedError[] = [];
      if (windowUnits(keyWindow) + input.units > quotaLimit(input.policy.key, input.quotaKind)) {
        failures.push(new GovernanceRejectedError({
          reason: "quota",
          scope: "key",
          quotaKind: input.quotaKind,
          retryAfterSeconds: month.retryAfterSeconds,
        }));
      }
      if (windowUnits(userWindow) + input.units > quotaLimit(input.policy.user, input.quotaKind)) {
        failures.push(new GovernanceRejectedError({
          reason: "quota",
          scope: "user",
          quotaKind: input.quotaKind,
          retryAfterSeconds: month.retryAfterSeconds,
        }));
      }
      if (failures.length > 0) {
        await deleteLease(tx, lease.id);
        return { rejection: longestRejection(failures) };
      }

      await addReservation(tx, keyWindow.id, input.units);
      await addReservation(tx, userWindow.id, input.units);
      const updated = await tx.execute(sql`
        UPDATE "gateway_governance_leases"
           SET "quota_kind" = ${input.quotaKind},
               "quota_month_start" = ${month.start},
               "reserved_units" = ${input.units}
         WHERE "id" = ${lease.id}
         RETURNING "id"
      `);
      if (rowsOf(updated).length !== 1) {
        throw new GovernanceStateError("Failed to attach governance reservation");
      }
      return "ok";
    });
    if (result === "expired") throw new GovernanceStateError("Governance lease expired");
    if (result !== "ok") throw result.rejection;
  }

  async markProviderStarted(leaseId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const lease = await lockLease(tx, leaseId);
      if (!lease) throw new GovernanceStateError("Governance lease expired");
      const now = await readDatabaseNow(tx);
      if (dateValue(lease.lease_expires_at).getTime() <= now.getTime()) {
        throw new GovernanceStateError("Governance lease expired");
      }
      const result = await tx.execute(sql`
        UPDATE "gateway_governance_leases"
           SET "provider_started_at" = coalesce("provider_started_at", statement_timestamp())
         WHERE "id" = ${leaseId}
           AND "lease_expires_at" > statement_timestamp()
         RETURNING "id"
      `);
      if (rowsOf(result).length !== 1) throw new GovernanceStateError("Governance lease expired");
    });
  }

  async heartbeat(leaseId: string): Promise<Date> {
    return this.db.transaction(async (tx) => {
      const lease = await lockLease(tx, leaseId);
      if (!lease) throw new GovernanceStateError("Governance lease expired");
      const now = await readDatabaseNow(tx);
      if (dateValue(lease.lease_expires_at).getTime() <= now.getTime()) {
        throw new GovernanceStateError("Governance lease expired");
      }
      const result = await tx.execute(sql`
        UPDATE "gateway_governance_leases"
           SET "lease_expires_at" = statement_timestamp() + interval '120 seconds'
         WHERE "id" = ${leaseId}
           AND "lease_expires_at" > statement_timestamp()
         RETURNING "lease_expires_at"
      `);
      const [row] = rowsOf<{ lease_expires_at: Date | string }>(result);
      if (!row) throw new GovernanceStateError("Governance lease expired");
      return dateValue(row.lease_expires_at);
    });
  }

  async finalize(leaseId: string, actualUnits?: number): Promise<GovernanceSettlement> {
    if (actualUnits !== undefined) requireNonNegativeUnits(actualUnits);
    return this.db.transaction(async (tx) => {
      const lease = await lockLease(tx, leaseId);
      if (!lease) return { settled: false };
      await lockSubject(tx, lease.key_subject_id);
      await lockSubject(tx, lease.user_subject_id);
      const reserved = reservedUnits(lease);
      const actual = lease.provider_started_at ? (actualUnits ?? reserved) : 0;
      await settleLockedLease(tx, lease, actual);
      return {
        settled: true,
        ...(lease.quota_kind ? { quotaKind: lease.quota_kind, actualUnits: actual } : {}),
        ...(lease.quota_kind && actual > reserved ? { overage: true } : {}),
      };
    });
  }

  async reapExpiredOne(): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        SELECT "id", "key_subject_id", "user_subject_id", "operation",
               "quota_kind", "quota_month_start", "reserved_units",
               "provider_started_at", "lease_expires_at"
          FROM "gateway_governance_leases"
         WHERE "lease_expires_at" <= statement_timestamp()
         ORDER BY "id" ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      `);
      const [lease] = rowsOf<LeaseRow>(result);
      if (!lease) return false;
      await lockSubject(tx, lease.key_subject_id);
      await lockSubject(tx, lease.user_subject_id);
      await settleLockedLease(tx, lease, lease.provider_started_at ? reservedUnits(lease) : 0);
      return true;
    });
  }

  /** 同一 flush 必须整批提交，避免部分成功后重试造成计数重复。 */
  async upsertHourly(deltas: readonly GatewayGovernanceHourlyDelta[]): Promise<void> {
    if (deltas.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const delta of deltas) {
        await tx.execute(sql`
          INSERT INTO "gateway_governance_hourly" (
            "bucket_start", "scope", "request_count", "rpm_peak", "concurrency_peak",
            "rate_rejected", "concurrency_rejected", "quota_chat_tokens_rejected",
            "quota_image_count_rejected", "quota_tts_code_points_rejected",
            "quota_stt_seconds_rejected", "updated_at"
          ) VALUES (
            ${delta.bucketStart}, ${delta.scope}, ${delta.requestCount}, ${delta.rpmPeak},
            ${delta.concurrencyPeak}, ${delta.rateRejected}, ${delta.concurrencyRejected},
            ${delta.quotaChatTokensRejected}, ${delta.quotaImageCountRejected},
            ${delta.quotaTtsCodePointsRejected}, ${delta.quotaSttSecondsRejected},
            statement_timestamp()
          )
          ON CONFLICT ("bucket_start", "scope") DO UPDATE SET
            "request_count" = "gateway_governance_hourly"."request_count"
              + excluded."request_count",
            "rpm_peak" = greatest("gateway_governance_hourly"."rpm_peak", excluded."rpm_peak"),
            "concurrency_peak" = greatest(
              "gateway_governance_hourly"."concurrency_peak",
              excluded."concurrency_peak"
            ),
            "rate_rejected" = "gateway_governance_hourly"."rate_rejected"
              + excluded."rate_rejected",
            "concurrency_rejected" = "gateway_governance_hourly"."concurrency_rejected"
              + excluded."concurrency_rejected",
            "quota_chat_tokens_rejected" =
              "gateway_governance_hourly"."quota_chat_tokens_rejected"
              + excluded."quota_chat_tokens_rejected",
            "quota_image_count_rejected" =
              "gateway_governance_hourly"."quota_image_count_rejected"
              + excluded."quota_image_count_rejected",
            "quota_tts_code_points_rejected" =
              "gateway_governance_hourly"."quota_tts_code_points_rejected"
              + excluded."quota_tts_code_points_rejected",
            "quota_stt_seconds_rejected" =
              "gateway_governance_hourly"."quota_stt_seconds_rejected"
              + excluded."quota_stt_seconds_rejected",
            "updated_at" = statement_timestamp()
        `);
      }
    });
  }
}

export async function createGatewayGovernanceRepository(): Promise<GatewayGovernanceRepository> {
  const { getDb } = await import("@/lib/infra/db");
  return new GatewayGovernanceRepository(await getDb());
}

async function ensureSubjects(
  tx: SqlExecutor,
  identity: GovernanceIdentity,
  policy: GatewayGovernancePolicy,
  fingerprint: string,
): Promise<SubjectPair> {
  await tx.execute(sql`
    INSERT INTO "gateway_governance_subjects" (
      "api_key_id", "rate_tokens", "rate_refilled_at", "policy_fingerprint"
    )
    VALUES (${identity.apiKeyId}, ${policy.key.burst}, statement_timestamp(), ${fingerprint})
    ON CONFLICT ("api_key_id") WHERE "api_key_id" IS NOT NULL DO NOTHING
  `);
  await tx.execute(sql`
    INSERT INTO "gateway_governance_subjects" (
      "user_id", "rate_tokens", "rate_refilled_at", "policy_fingerprint"
    )
    VALUES (${identity.userId}, ${policy.user.burst}, statement_timestamp(), ${fingerprint})
    ON CONFLICT ("user_id") WHERE "user_id" IS NOT NULL DO NOTHING
  `);
  const keyResult = await tx.execute(sql`
    SELECT "id" FROM "gateway_governance_subjects" WHERE "api_key_id" = ${identity.apiKeyId}
  `);
  const userResult = await tx.execute(sql`
    SELECT "id" FROM "gateway_governance_subjects" WHERE "user_id" = ${identity.userId}
  `);
  const [key] = rowsOf<{ id: string }>(keyResult);
  const [user] = rowsOf<{ id: string }>(userResult);
  if (!key || !user) throw new GovernanceStateError("Failed to resolve governance subjects");
  return { keySubjectId: String(key.id), userSubjectId: String(user.id) };
}

async function lockSubject(tx: SqlExecutor, subjectId: string): Promise<void> {
  const result = await tx.execute(sql`
    SELECT "id" FROM "gateway_governance_subjects" WHERE "id" = ${subjectId} FOR UPDATE
  `);
  if (rowsOf(result).length !== 1) throw new GovernanceStateError("Governance subject is missing");
}

async function refillSubject(
  tx: SqlExecutor,
  subjectId: string,
  limits: GatewayScopeLimits,
  fingerprint: string,
): Promise<{ tokens: number; minuteRequests: number }> {
  const result = await tx.execute(sql`
    UPDATE "gateway_governance_subjects"
       SET "rate_tokens" = CASE
             WHEN "policy_fingerprint" <> ${fingerprint} THEN ${limits.burst}
             ELSE least(
               ${limits.burst},
               "rate_tokens" + greatest(
                 0,
                 extract(epoch from (statement_timestamp() - "rate_refilled_at"))
               ) * ${limits.rpm} / 60.0
             )
           END,
           "rate_refilled_at" = statement_timestamp(),
           "metrics_minute_requests" = CASE
             WHEN "metrics_minute_start" =
               date_trunc('minute', statement_timestamp() at time zone 'UTC') at time zone 'UTC'
             THEN "metrics_minute_requests" + 1
             ELSE 1
           END,
           "metrics_minute_start" =
             date_trunc('minute', statement_timestamp() at time zone 'UTC') at time zone 'UTC',
           "policy_fingerprint" = ${fingerprint},
           "updated_at" = statement_timestamp()
     WHERE "id" = ${subjectId}
     RETURNING "rate_tokens", "metrics_minute_requests"
  `);
  const [row] = rowsOf<{
    rate_tokens: number | string;
    metrics_minute_requests: number | string;
  }>(result);
  if (!row) throw new GovernanceStateError("Failed to refill governance rate bucket");
  return {
    tokens: numberValue(row.rate_tokens),
    minuteRequests: numberValue(row.metrics_minute_requests),
  };
}

async function decrementRateToken(tx: SqlExecutor, subjectId: string): Promise<void> {
  const result = await tx.execute(sql`
    UPDATE "gateway_governance_subjects"
       SET "rate_tokens" = "rate_tokens" - 1,
           "updated_at" = statement_timestamp()
     WHERE "id" = ${subjectId}
       AND "rate_tokens" >= 1
     RETURNING "id"
  `);
  if (rowsOf(result).length !== 1) throw new GovernanceStateError("Failed to consume rate token");
}

async function lockRelatedLeases(tx: SqlExecutor, subjects: SubjectPair): Promise<LeaseRow[]> {
  const result = await tx.execute(sql`
    SELECT "id", "key_subject_id", "user_subject_id", "operation",
           "quota_kind", "quota_month_start", "reserved_units",
           "provider_started_at", "lease_expires_at"
      FROM "gateway_governance_leases"
     WHERE "key_subject_id" = ${subjects.keySubjectId}
        OR "user_subject_id" = ${subjects.userSubjectId}
     ORDER BY "id" ASC
     FOR UPDATE
  `);
  return rowsOf<LeaseRow>(result);
}

async function readActiveLeaseCounts(tx: SqlExecutor, subjects: SubjectPair): Promise<{
  keyCount: number;
  userCount: number;
  keyRetryAt: Date;
  userRetryAt: Date;
  now: Date;
}> {
  const result = await tx.execute(sql`
    SELECT
      count(*) filter (where "key_subject_id" = ${subjects.keySubjectId}) AS "key_count",
      count(*) filter (where "user_subject_id" = ${subjects.userSubjectId}) AS "user_count",
      min("lease_expires_at") filter (
        where "key_subject_id" = ${subjects.keySubjectId}
      ) AS "key_retry_at",
      min("lease_expires_at") filter (
        where "user_subject_id" = ${subjects.userSubjectId}
      ) AS "user_retry_at",
      statement_timestamp() AS "now"
    FROM "gateway_governance_leases"
    WHERE "lease_expires_at" > statement_timestamp()
      AND (
        "key_subject_id" = ${subjects.keySubjectId}
        OR "user_subject_id" = ${subjects.userSubjectId}
      )
  `);
  const [row] = rowsOf<{
    key_count: number | string;
    user_count: number | string;
    key_retry_at: Date | string | null;
    user_retry_at: Date | string | null;
    now: Date | string;
  }>(result);
  if (!row) throw new GovernanceStateError("Failed to count governance leases");
  const now = dateValue(row.now);
  return {
    keyCount: numberValue(row.key_count),
    userCount: numberValue(row.user_count),
    keyRetryAt: row.key_retry_at ? dateValue(row.key_retry_at) : now,
    userRetryAt: row.user_retry_at ? dateValue(row.user_retry_at) : now,
    now,
  };
}

async function lockLease(tx: SqlExecutor, leaseId: string): Promise<LeaseRow | null> {
  const result = await tx.execute(sql`
    SELECT "id", "key_subject_id", "user_subject_id", "operation",
           "quota_kind", "quota_month_start", "reserved_units",
           "provider_started_at", "lease_expires_at"
      FROM "gateway_governance_leases"
     WHERE "id" = ${leaseId}
     FOR UPDATE
  `);
  return rowsOf<LeaseRow>(result)[0] ?? null;
}

async function ensureQuotaWindow(
  tx: SqlExecutor,
  subjectId: string,
  quotaKind: GatewayQuotaKind,
  monthStart: Date,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO "gateway_quota_windows" (
      "subject_id", "quota_kind", "month_start", "reserved_units", "used_units"
    )
    VALUES (${subjectId}, ${quotaKind}, ${monthStart}, 0, 0)
    ON CONFLICT ("subject_id", "quota_kind", "month_start") DO NOTHING
  `);
}

async function lockQuotaWindow(
  tx: SqlExecutor,
  subjectId: string,
  quotaKind: GatewayQuotaKind,
  monthStart: Date,
): Promise<{ id: string; reserved_units: number | string; used_units: number | string }> {
  const result = await tx.execute(sql`
    SELECT "id", "reserved_units", "used_units"
      FROM "gateway_quota_windows"
     WHERE "subject_id" = ${subjectId}
       AND "quota_kind" = ${quotaKind}
       AND "month_start" = ${monthStart}
     FOR UPDATE
  `);
  const [row] = rowsOf<{
    id: string;
    reserved_units: number | string;
    used_units: number | string;
  }>(result);
  if (!row) throw new GovernanceStateError("Governance quota window is missing");
  return row;
}

async function addReservation(tx: SqlExecutor, windowId: string, units: number): Promise<void> {
  const result = await tx.execute(sql`
    UPDATE "gateway_quota_windows"
       SET "reserved_units" = "reserved_units" + ${units},
           "updated_at" = statement_timestamp()
     WHERE "id" = ${windowId}
     RETURNING "id"
  `);
  if (rowsOf(result).length !== 1) throw new GovernanceStateError("Failed to reserve quota");
}

async function settleLockedLease(
  tx: SqlExecutor,
  lease: LeaseRow,
  actualUnits: number,
): Promise<void> {
  requireNonNegativeUnits(actualUnits);
  if (lease.quota_kind && lease.quota_month_start && lease.reserved_units !== null) {
    const monthStart = dateValue(lease.quota_month_start);
    const reserved = reservedUnits(lease);
    const keyWindow = await lockQuotaWindow(
      tx,
      lease.key_subject_id,
      lease.quota_kind,
      monthStart,
    );
    const userWindow = await lockQuotaWindow(
      tx,
      lease.user_subject_id,
      lease.quota_kind,
      monthStart,
    );
    await settleQuotaWindow(tx, keyWindow.id, reserved, actualUnits);
    await settleQuotaWindow(tx, userWindow.id, reserved, actualUnits);
  }
  await deleteLease(tx, lease.id);
}

async function settleQuotaWindow(
  tx: SqlExecutor,
  windowId: string,
  reserved: number,
  actual: number,
): Promise<void> {
  const result = await tx.execute(sql`
    UPDATE "gateway_quota_windows"
       SET "reserved_units" = "reserved_units" - ${reserved},
           "used_units" = "used_units" + ${actual},
           "updated_at" = statement_timestamp()
     WHERE "id" = ${windowId}
       AND "reserved_units" >= ${reserved}
     RETURNING "id"
  `);
  if (rowsOf(result).length !== 1) {
    throw new GovernanceStateError("Governance quota reservation is inconsistent");
  }
}

async function deleteLease(tx: SqlExecutor, leaseId: string): Promise<void> {
  const result = await tx.execute(sql`
    DELETE FROM "gateway_governance_leases" WHERE "id" = ${leaseId} RETURNING "id"
  `);
  if (rowsOf(result).length !== 1) throw new GovernanceStateError("Governance lease is missing");
}

async function readDatabaseNow(tx: SqlExecutor): Promise<Date> {
  const result = await tx.execute(sql`SELECT statement_timestamp() AS "now"`);
  const [row] = rowsOf<{ now: Date | string }>(result);
  if (!row) throw new GovernanceStateError("Failed to read database time");
  return dateValue(row.now);
}

async function readUtcMonth(tx: SqlExecutor): Promise<{
  start: Date;
  retryAfterSeconds: number;
}> {
  const result = await tx.execute(sql`
    SELECT
      date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC'
        AS "month_start",
      ceil(extract(epoch from (
        (date_trunc('month', statement_timestamp() at time zone 'UTC') + interval '1 month')
          at time zone 'UTC' - statement_timestamp()
      ))) AS "retry_after"
  `);
  const [row] = rowsOf<{
    month_start: Date | string;
    retry_after: number | string;
  }>(result);
  if (!row) throw new GovernanceStateError("Failed to read UTC quota month");
  return {
    start: dateValue(row.month_start),
    retryAfterSeconds: Math.max(1, Math.ceil(numberValue(row.retry_after))),
  };
}

function rateFailure(
  scope: GovernanceScope,
  tokens: number,
  rpm: number,
  observation: GovernanceObservation,
): GovernanceRejectedError | null {
  if (tokens >= 1) return null;
  return new GovernanceRejectedError({
    reason: "rate",
    scope,
    retryAfterSeconds: ((1 - tokens) * 60) / rpm,
    observation,
  });
}

function longestRejection(errors: GovernanceRejectedError[]): GovernanceRejectedError {
  const selected = errors.reduce((current, next) => (
    next.retryAfterSeconds > current.retryAfterSeconds ? next : current
  ));
  return new GovernanceRejectedError({
    reason: selected.reason,
    scope: selected.scope,
    retryAfterSeconds: selected.retryAfterSeconds,
    quotaKind: selected.quotaKind,
    observation: selected.observation,
    affectedScopes: [...new Set(errors.map((error) => error.scope))],
  });
}

function quotaLimit(limits: GatewayScopeLimits, kind: GatewayQuotaKind): number {
  switch (kind) {
    case "chat_tokens": return limits.chatTokensPerMonth;
    case "image_count": return limits.imageCountPerMonth;
    case "tts_code_points": return limits.ttsCodePointsPerMonth;
    case "stt_seconds": return limits.sttSecondsPerMonth;
  }
}

function windowUnits(window: { reserved_units: number | string; used_units: number | string }): number {
  return numberValue(window.reserved_units) + numberValue(window.used_units);
}

function reservedUnits(lease: LeaseRow): number {
  return lease.reserved_units === null ? 0 : numberValue(lease.reserved_units);
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows?: T[] }).rows ?? []);
  }
  return [];
}

function numberValue(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new GovernanceStateError("Invalid governance numeric state");
  return parsed;
}

function dateValue(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new GovernanceStateError("Invalid governance timestamp");
  return date;
}

function secondsUntil(target: Date, now: Date): number {
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1_000));
}

function requirePositiveUnits(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GovernanceStateError("Governance reservation must be a positive safe integer");
  }
}

function requireNonNegativeUnits(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GovernanceStateError("Governance settlement must be a non-negative safe integer");
  }
}
