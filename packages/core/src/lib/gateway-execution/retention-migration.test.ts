import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("gateway retention PostgreSQL baseline", () => {
  it("contains model type, retention index and singleton state", () => {
    const migration = readFileSync(join(migrationDir, "0000_baseline.sql"), "utf8");
    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0000_snapshot.json"), "utf8"),
    ) as {
      tables: Record<string, {
        columns?: Record<string, unknown>;
        indexes?: Record<string, { columns: Array<{ expression: string }> }>;
      }>;
    };

    expect(migration).toContain('CREATE TABLE "gateway_retention_state"');
    expect(migration).toContain('"last_claimed_date" date NOT NULL');
    expect(snapshot.tables["public.gateway_executions"]?.columns).toHaveProperty("model_type");
    expect(snapshot.tables["public.gateway_executions"]?.indexes?.gateway_executions_retention_idx
      ?.columns.map((column) => column.expression)).toEqual(["status", "created_at", "id"]);
  });
});
