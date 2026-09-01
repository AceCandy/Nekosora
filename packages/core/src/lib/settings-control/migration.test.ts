import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("settings control PostgreSQL migration", () => {
  it("creates revision, immutable history and private hourly aggregates", () => {
    const migration = readFileSync(
      join(migrationDir, "0000_baseline.sql"),
      "utf8",
    );
    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0000_snapshot.json"), "utf8"),
    ) as {
      tables: Record<string, {
        columns?: Record<string, unknown>;
        indexes?: Record<string, { isUnique?: boolean; where?: string }>;
      }>;
    };

    expect(migration).toContain(
      `INSERT INTO "settings_control_state" ("id", "current_revision") VALUES ('global', 0)`,
    );
    expect(migration).toContain('CREATE TRIGGER "settings_change_sets_applied_immutable"');
    expect(migration).toContain("IF OLD.\"status\" = 'applied'");

    const changeSets = snapshot.tables["public.settings_change_sets"];
    expect(changeSets?.columns).toHaveProperty("changes");
    expect(changeSets?.indexes?.settings_change_sets_single_draft_idx).toMatchObject({
      isUnique: true,
      where: `"settings_change_sets"."status" = 'draft'`,
    });

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
