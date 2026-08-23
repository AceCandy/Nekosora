import { sql } from "drizzle-orm";
import { getDb } from "@/lib/infra/db";
import type { GatewayGovernancePolicy } from "./policy";
import type { GatewayQuotaKind, GovernanceScope } from "./repository";

export type GovernanceHistoryRange = 7 | 30 | 90;

export interface GatewayGovernanceHourlyPoint {
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
  updatedAt: Date;
}

export interface GatewayGovernanceReplay {
  scope: GovernanceScope;
  hours: number;
  rpmExceededHours: number;
  concurrencyExceededHours: number;
}

export interface GatewayGovernanceQuotaReplay {
  scope: GovernanceScope;
  quotaKind: GatewayQuotaKind;
  maximumUnits: number;
  subjectsOverCandidate: number;
}

export async function getGatewayGovernanceInsights(
  range: GovernanceHistoryRange,
  candidate: GatewayGovernancePolicy,
): Promise<{
  points: GatewayGovernanceHourlyPoint[];
  replay: GatewayGovernanceReplay[];
  quotas: GatewayGovernanceQuotaReplay[];
  lastUpdatedAt: Date | null;
  dataDelayed: boolean;
}> {
  const db = await getDb();
  const hourlyResult = await db.execute(sql`
    SELECT "bucket_start", "scope", "request_count", "rpm_peak", "concurrency_peak",
           "rate_rejected", "concurrency_rejected", "quota_chat_tokens_rejected",
           "quota_image_count_rejected", "quota_tts_code_points_rejected",
           "quota_stt_seconds_rejected", "updated_at",
           max("updated_at") OVER () < statement_timestamp() - interval '10 seconds'
             AS "data_delayed"
      FROM "gateway_governance_hourly"
     WHERE "bucket_start" >= statement_timestamp() - (${range} * interval '1 day')
     ORDER BY "bucket_start" ASC, "scope" ASC
  `);
  const hourlyRows = rowsOf<Record<string, unknown>>(hourlyResult);
  const points = hourlyRows.map(hourlyPoint);
  const quotaResult = await db.execute(sql`
    WITH "subject_usage" AS (
      SELECT CASE WHEN "subject"."api_key_id" IS NULL THEN 'user' ELSE 'key' END AS "scope",
             "window"."quota_kind",
             "window"."used_units" + "window"."reserved_units" AS "units"
        FROM "gateway_quota_windows" AS "window"
        JOIN "gateway_governance_subjects" AS "subject" ON "subject"."id" = "window"."subject_id"
       WHERE "window"."month_start" =
         date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC'
    )
    SELECT "scope", "quota_kind", max("units") AS "maximum_units",
           count(*) FILTER (WHERE "units" > CASE
             WHEN "scope" = 'key' AND "quota_kind" = 'chat_tokens' THEN ${candidate.key.chatTokensPerMonth}
             WHEN "scope" = 'key' AND "quota_kind" = 'image_count' THEN ${candidate.key.imageCountPerMonth}
             WHEN "scope" = 'key' AND "quota_kind" = 'tts_code_points' THEN ${candidate.key.ttsCodePointsPerMonth}
             WHEN "scope" = 'key' AND "quota_kind" = 'stt_seconds' THEN ${candidate.key.sttSecondsPerMonth}
             WHEN "scope" = 'user' AND "quota_kind" = 'chat_tokens' THEN ${candidate.user.chatTokensPerMonth}
             WHEN "scope" = 'user' AND "quota_kind" = 'image_count' THEN ${candidate.user.imageCountPerMonth}
             WHEN "scope" = 'user' AND "quota_kind" = 'tts_code_points' THEN ${candidate.user.ttsCodePointsPerMonth}
             ELSE ${candidate.user.sttSecondsPerMonth}
           END) AS "subjects_over_candidate"
      FROM "subject_usage"
     GROUP BY "scope", "quota_kind"
     ORDER BY "scope", "quota_kind"
  `);
  return {
    points,
    replay: buildGatewayGovernanceReplay(points, candidate),
    quotas: rowsOf<Record<string, unknown>>(quotaResult).map((row) => ({
      scope: scopeValue(row.scope),
      quotaKind: quotaKindValue(row.quota_kind),
      maximumUnits: integerValue(row.maximum_units),
      subjectsOverCandidate: integerValue(row.subjects_over_candidate),
    })),
    lastUpdatedAt: points.reduce<Date | null>((latest, point) => (
      !latest || point.updatedAt > latest ? point.updatedAt : latest
    ), null),
    dataDelayed: Boolean(hourlyRows[0]?.data_delayed),
  };
}

export function buildGatewayGovernanceReplay(
  points: readonly GatewayGovernanceHourlyPoint[],
  candidate: GatewayGovernancePolicy,
): GatewayGovernanceReplay[] {
  return (["key", "user"] as const).map((scope) => {
    const scoped = points.filter((point) => point.scope === scope);
    return {
      scope,
      hours: scoped.length,
      rpmExceededHours: scoped.filter((point) => point.rpmPeak > candidate[scope].rpm).length,
      concurrencyExceededHours: scoped.filter((point) => (
        point.concurrencyPeak > candidate[scope].concurrency
      )).length,
    };
  });
}

function hourlyPoint(row: Record<string, unknown>): GatewayGovernanceHourlyPoint {
  return {
    bucketStart: dateValue(row.bucket_start),
    scope: scopeValue(row.scope),
    requestCount: integerValue(row.request_count),
    rpmPeak: integerValue(row.rpm_peak),
    concurrencyPeak: integerValue(row.concurrency_peak),
    rateRejected: integerValue(row.rate_rejected),
    concurrencyRejected: integerValue(row.concurrency_rejected),
    quotaChatTokensRejected: integerValue(row.quota_chat_tokens_rejected),
    quotaImageCountRejected: integerValue(row.quota_image_count_rejected),
    quotaTtsCodePointsRejected: integerValue(row.quota_tts_code_points_rejected),
    quotaSttSecondsRejected: integerValue(row.quota_stt_seconds_rejected),
    updatedAt: dateValue(row.updated_at),
  };
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows?: T[] }).rows ?? [];
  }
  return [];
}

function integerValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("治理聚合数值非法");
  return parsed;
}

function dateValue(value: unknown): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error("治理聚合时间非法");
  return parsed;
}

function scopeValue(value: unknown): GovernanceScope {
  if (value !== "key" && value !== "user") throw new Error("治理聚合 Scope 非法");
  return value;
}

function quotaKindValue(value: unknown): GatewayQuotaKind {
  if (value !== "chat_tokens" && value !== "image_count"
    && value !== "tts_code_points" && value !== "stt_seconds") {
    throw new Error("治理聚合额度类型非法");
  }
  return value;
}
