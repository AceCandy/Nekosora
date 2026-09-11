import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("settings control PostgreSQL migration", () => {
  it("keeps revision and hourly aggregates while removing settings history", () => {
    const migration = readFileSync(
      join(migrationDir, "0000_baseline.sql"),
      "utf8",
    );
    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0002_snapshot.json"), "utf8"),
    ) as {
      enums: Record<string, unknown>;
      tables: Record<string, {
        columns?: Record<string, { notNull?: boolean }>;
        indexes?: Record<string, { isUnique?: boolean; where?: string }>;
      }>;
    };

    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries[2]).toMatchObject({ idx: 2, tag: "0002_remove_settings_history" });

    expect(migration).toContain(
      `INSERT INTO "settings_control_state" ("id", "current_revision") VALUES ('global', 0)`,
    );
    const cleanup = readFileSync(join(migrationDir, "0002_remove_settings_history.sql"), "utf8");
    expect(cleanup).toContain('DROP TABLE "settings_change_sets"');
    expect(cleanup).toContain('DROP FUNCTION "prevent_applied_settings_change_set_mutation"()');
    expect(cleanup).not.toContain("CASCADE");
    expect(snapshot.tables).not.toHaveProperty("public.settings_change_sets");
    expect(snapshot.enums).not.toHaveProperty("public.settings_change_set_kind");
    expect(snapshot.tables["public.settings_control_state"].columns).toHaveProperty("current_revision");
    expect(snapshot.tables).toHaveProperty("public.system_settings");

    const hourly = snapshot.tables["public.gateway_governance_hourly"];
    expect(hourly?.indexes?.gateway_governance_hourly_bucket_scope_idx?.isUnique).toBe(true);
    expect(Object.keys(hourly?.columns ?? {})).toEqual([
      "id",
      "bucket_start",
      "scope",
      "request_count",
      "rpm_peak",
      "concurrency_peak",
      "rate_rejected",
      "concurrency_rejected",
      "quota_chat_tokens_rejected",
      "quota_image_count_rejected",
      "quota_tts_code_points_rejected",
      "quota_stt_seconds_rejected",
      "updated_at",
    ]);
  });
});
