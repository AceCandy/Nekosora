import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "drizzle", "pg");

describe("gateway governance PostgreSQL baseline", () => {
  it("contains governance state, constraints and media usage", () => {
    const sql = readFileSync(join(migrationsDir, "0000_baseline.sql"), "utf8");
    const snapshot = JSON.parse(
      readFileSync(join(migrationsDir, "meta", "0000_snapshot.json"), "utf8"),
    );

    expect(sql).toContain('CREATE TYPE "public"."gateway_governance_operation"');
    expect(sql).toContain('CREATE TYPE "public"."gateway_quota_kind"');
    expect(sql).toContain('CREATE TABLE "gateway_governance_subjects"');
    expect(sql).toContain('CREATE TABLE "gateway_quota_windows"');
    expect(sql).toContain('CREATE TABLE "gateway_governance_leases"');
    expect(sql).toContain("gateway_governance_subjects_identity_check");
    expect(sql).toContain("gateway_quota_windows_month_start_check");
    expect(sql).toContain("gateway_governance_leases_quota_fields_check");
    expect(snapshot.tables["public.gateway_executions"].columns).toHaveProperty("image_count");
    expect(snapshot.tables["public.gateway_executions"].columns).toHaveProperty("tts_code_points");
    expect(snapshot.tables["public.gateway_executions"].columns).toHaveProperty("stt_seconds");
  });
});
