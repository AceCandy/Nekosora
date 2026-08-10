import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "drizzle", "pg");
const migrationFiles = existsSync(migrationsDir)
  ? readdirSync(migrationsDir).filter((name) => /^0010_.*\.sql$/.test(name))
  : [];

describe("gateway governance PostgreSQL migration", () => {
  it("adds one append-only migration with governance state and media usage", () => {
    expect(migrationFiles).toHaveLength(1);
    const sql = readFileSync(join(migrationsDir, migrationFiles[0]), "utf8");

    expect(sql).toContain("CREATE TYPE \"public\".\"gateway_governance_operation\"");
    expect(sql).toContain("CREATE TYPE \"public\".\"gateway_quota_kind\"");
    expect(sql).toContain("CREATE TABLE \"gateway_governance_subjects\"");
    expect(sql).toContain("CREATE TABLE \"gateway_quota_windows\"");
    expect(sql).toContain("CREATE TABLE \"gateway_governance_leases\"");
    expect(sql).toContain("gateway_governance_subjects_identity_check");
    expect(sql).toContain("gateway_quota_windows_month_start_check");
    expect(sql).toContain("gateway_governance_leases_quota_fields_check");
    expect(sql).toContain("ON DELETE restrict");
    expect(sql).toContain("ADD COLUMN \"image_count\"");
    expect(sql).toContain("ADD COLUMN \"tts_code_points\"");
    expect(sql).toContain("ADD COLUMN \"stt_seconds\"");
    expect(sql).not.toMatch(/\bUPDATE\s+\"?(gateway_executions|gateway_attempts)\"?/i);
  });

  it("keeps journal and snapshot continuity", () => {
    expect(migrationFiles).toHaveLength(1);
    const tag = migrationFiles[0].replace(/\.sql$/, "");
    const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"));
    const entry = journal.entries.at(-1);
    expect(entry).toMatchObject({ idx: 10, version: "7", tag, breakpoints: true });

    const previous = JSON.parse(readFileSync(join(migrationsDir, "meta", "0009_snapshot.json"), "utf8"));
    const currentPath = join(migrationsDir, "meta", "0010_snapshot.json");
    expect(existsSync(currentPath)).toBe(true);
    const current = JSON.parse(readFileSync(currentPath, "utf8"));
    expect(current.prevId).toBe(previous.id);
    expect(current.tables["public.gateway_governance_subjects"]).toBeDefined();
    expect(current.tables["public.gateway_quota_windows"]).toBeDefined();
    expect(current.tables["public.gateway_governance_leases"]).toBeDefined();
  });
});
