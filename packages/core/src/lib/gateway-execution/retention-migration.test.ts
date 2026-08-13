import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("gateway retention PostgreSQL migration", () => {
  it("追加 model type、retention index、单行状态表并同步 journal/snapshot", () => {
    const migration = readFileSync(
      join(migrationDir, "0012_big_the_watchers.sql"),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "gateway_retention_state"');
    expect(migration).toContain('"last_claimed_date" date NOT NULL');
    expect(migration).toContain('ADD COLUMN "model_type" text');
    expect(migration).toContain(
      'CREATE INDEX "gateway_executions_retention_idx" ON "gateway_executions" USING btree ("status","created_at","id")',
    );
    expect(migration).not.toContain("DROP TABLE");
    expect(migration).not.toContain("DROP COLUMN");

    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries).toContainEqual(expect.objectContaining({
      idx: 12,
      tag: "0012_big_the_watchers",
    }));

    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0012_snapshot.json"), "utf8"),
    ) as {
      tables: Record<string, {
        columns?: Record<string, unknown>;
        indexes?: Record<string, { columns: Array<{ expression: string }> }>;
      }>;
    };
    expect(snapshot.tables).toHaveProperty("public.gateway_retention_state");
    expect(snapshot.tables["public.gateway_executions"]?.columns).toHaveProperty("model_type");
    expect(snapshot.tables["public.gateway_executions"]?.indexes?.gateway_executions_retention_idx
      ?.columns.map((column) => column.expression)).toEqual(["status", "created_at", "id"]);
  });
});
